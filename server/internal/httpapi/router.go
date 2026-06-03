// Package httpapi contains the REST HTTP layer: chi router, middleware
// stack, and handler functions. Named httpapi (not http) to avoid collision
// with the standard net/http package import.
//
// Faz 2 PR-2: foundational router with /healthz and /readyz. Auth and
// inventory endpoints come in subsequent PRs.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"

	"envanter.app/server/internal/metrics"
)

// DBPinger is the minimum DB interface needed for /readyz.
//
// pgxpool.Pool satisfies this; tests can inject fakes.
type DBPinger interface {
	Ping(ctx context.Context) error
}

// Deps groups dependencies needed for the HTTP layer.
//
// Auth, Folder, Item, WS are optional: when nil their routes are not mounted
// (useful for foundation tests that don't exercise those flows).
type Deps struct {
	Logger        *slog.Logger
	DB            DBPinger
	Auth          *AuthHandlers
	Folder        *FolderHandlers
	Item          *ItemHandlers
	Attachment    *AttachmentHandlers
	Admin         *AdminHandlers
	ClientCert    *ClientCertHandlers // PR-SEC3: mTLS client certificate management
	SSO           *SSOHandlers        // PR-LDAP: SSO/LDAP provider admin CRUD
	Group         *GroupHandlers
	Catalog       *CatalogHandlers
	WS            *WSHandlers
	Tag           *TagHandlers
	Export        *ExportHandlers
	Notification  *NotificationHandlers
	Graph         *GraphHandlers
	ShareLink     *ShareLinkHandlers
	Lifecycle     *LifecycleHandlers
	Pipeline      *PipelineHandlers
	LogForwarding *LogForwardingHandlers    // PR-LOG1: audit log forwarding to syslog/slack
	Vault         *VaultHandlers            // PR-VAULT: HashiCorp Vault proxy (ADR-0007)
	K8sCluster    *K8sClusterHandlers       // PR-K8S: Kubernetes cluster admin CRUD
	K8s           *K8sHandlers              // PR-K8S: Per-item live K8s data proxy
	Report        *ReportHandlers           // PR-K8S: HTML inventory report generation
	Template      *TemplateHandlers         // PR-TPL: User-defined item templates
	AISuggestion  *AISuggestionHandlers     // PR-AI: AI tag/relationship suggestions
	Ansible       *AnsibleInventoryHandlers // PR-ANSIBLE: Ansible dynamic inventory
	APIToken      *APITokenHandlers         // PR-ANSIBLE: API token management
	SCIM          *SCIMHandlers             // PR-SCIM: SCIM 2.0 user provisioning
	Scan          *ScanHandlers             // PR-SCAN: Secret fingerprint scanning
	Annotation      *AnnotationHandlers       // PR-DP01: Backstage-style item annotations
	PortalTemplate  *PortalTemplateHandlers   // PR-DP11: Golden Path portal templates
	CatalogEntity   *CatalogEntityHandlers    // PR-DP-E1: direct catalog entity endpoint
	CORSOrigins     []string                  // ENVANTER_CORS_ORIGINS
	PprofEnabled  bool                      // PR-PROD5: pprof debug endpoints
}

// NewRouter builds a chi router with the standard middleware stack.
//
// Middleware order is significant — see comments inline.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

	// 0. CORS — must be first so preflight OPTIONS requests are answered before
	//    any auth middleware can reject them. Allows Tauri desktop client
	//    (tauri://localhost, http://localhost:1420 dev) and same-origin web UI.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   d.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// 1. RequestID first — every subsequent log line + response carries it
	r.Use(middleware.RequestID)
	// 2. Echo request ID into response header (chi.RequestID only sets context).
	//    Lets client / curl / browser network tab correlate with server logs.
	r.Use(echoRequestIDHeader)
	// 3. RealIP — trust X-Forwarded-For from the ingress (Faz 5: tighten with TrustedIPs)
	r.Use(middleware.RealIP)
	// 4. Request logger — emits a single line per request via slog
	r.Use(slogRequestLogger(d.Logger))
	// 5. Recoverer — catches panics, logs + 500 instead of crashing
	r.Use(middleware.Recoverer)
	// 6. Prometheus request instrumentation (duration + count by route pattern)
	r.Use(metrics.Middleware)

	// NOTE: Timeout middleware is NOT applied globally here — it wraps
	// responses with http.TimeoutHandler which breaks Hijack (the WS
	// upgrade path needs Hijack). Apply Timeout per-route or per-Group
	// for endpoints that should be subject to it.
	timeoutMW := middleware.Timeout(30 * time.Second)

	// Session revocation checker: verifies access token's session is not
	// revoked on every authenticated request. This enables immediate
	// logout enforcement (no waiting for 15-min token expiry).
	var sessionCheck SessionChecker
	if d.Auth != nil {
		sessionCheck = NewDBSessionChecker(d.Auth.Service.DB)
	}
	requireAuth := func() func(http.Handler) http.Handler {
		if d.Auth == nil {
			return func(next http.Handler) http.Handler { return next }
		}
		return RequireAccessToken(d.Auth.Service.JWT, sessionCheck)
	}()

	// Health + metrics routes (unauthenticated, NOT timeout-wrapped)
	h := &handlers{deps: d}
	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)
	// /metrics is internal-only; restricted at the network layer (NetworkPolicy).
	r.Get("/metrics", metrics.Handler().ServeHTTP)

	// PR-PROD5: pprof CPU+memory profiling (ENVANTER_PPROF_ENABLED=true).
	// Admin-only — requires valid access token + admin role.
	if d.PprofEnabled && d.Auth != nil {
		r.Route("/debug/pprof", func(pr chi.Router) {
			pr.Use(requireAuth)
			pr.Use(RequireRole(RoleAdmin))
			pr.Get("/", pprof.Index)
			pr.Get("/cmdline", pprof.Cmdline)
			pr.Get("/profile", pprof.Profile)
			pr.Get("/symbol", pprof.Symbol)
			pr.Post("/symbol", pprof.Symbol)
			pr.Get("/trace", pprof.Trace)
			pr.Get("/{name}", pprof.Index)
		})
	}

	// WebSocket routes.
	// GET /ws must be mounted BEFORE timeout-wrapped groups; the long-lived
	// connection must not be wrapped by http.TimeoutHandler.
	// POST /ws/ticket is a short REST call — it IS timeout-wrapped.
	if d.WS != nil {
		r.Get("/api/v1/ws", d.WS.Connect)
		// Ticket endpoint: short-lived, subject to timeout + auth middleware.
		// d.Auth is always non-nil when d.WS is non-nil (main.go wires both together).
		if d.Auth != nil {
			r.With(timeoutMW, requireAuth).
				Post("/api/v1/ws/ticket", d.WS.IssueTicket)
		}
	}

	// Auth routes — only mounted when auth deps are provided.
	if d.Auth != nil {
		// Rate limit hot brute-force targets: ~5 burst, then 1 attempt /
		// 12 seconds sustained per IP. Auth-flow.md §"Rate limit" gives a
		// 5-attempts-per-15-minutes window; this is a tighter sliding-window
		// approximation (sustained = 5 attempts/min cap).
		authBruteRL := NewIPRateLimiter(rate.Every(12*time.Second), 5)

		r.Route("/api/v1/auth", func(ar chi.Router) {
			// REST routes are subject to the request budget; long-lived
			// streaming endpoints (/ws) live outside this group.
			ar.Use(timeoutMW)
			// Unauthenticated, brute-forceable.
			ar.Post("/register", d.Auth.Register)
			ar.With(authBruteRL.Middleware).Post("/login", d.Auth.Login)
			ar.With(authBruteRL.Middleware).Post("/refresh", d.Auth.Refresh)
			// Bootstrap panel (ADR-0010) — gated by ENVANTER_BOOTSTRAP_ENABLED.
			// /status  : public, returns {"setup_complete": bool}
			// /setup   : creates the ONE admin (fails if admin already exists)
			// /login   : TOTP-free login for the existing admin
			ar.Get("/bootstrap/status", d.Auth.BootstrapStatus)
			ar.With(authBruteRL.Middleware).Post("/bootstrap/setup", d.Auth.BootstrapSetup)
			ar.With(authBruteRL.Middleware).Post("/bootstrap/login", d.Auth.BootstrapLogin)

			// tmp-token-protected (totp enroll).
			ar.Post("/totp/init", d.Auth.TOTPInit)
			ar.With(authBruteRL.Middleware).Post("/totp/verify", d.Auth.TOTPVerify)

			// access-token-protected TOTP management (PR-F2a).
			ar.Get("/totp/status", d.Auth.TOTPStatus)
			ar.Delete("/totp", d.Auth.TOTPDisable)
			ar.With(authBruteRL.Middleware).Post("/totp/backup-codes/regenerate", d.Auth.TOTPRegenerateBackup)

			// access-token-protected.
			ar.Post("/logout", d.Auth.Logout)
			ar.Post("/logout-all", d.Auth.LogoutAll)
			ar.Post("/change-password", d.Auth.ChangePassword)
			ar.Post("/keypair-init", d.Auth.InitKeypair)

			// recovery flow — init is brute-forceable (rate-limit it),
			// complete is tmp-token gated.
			ar.With(authBruteRL.Middleware).Post("/recover/init", d.Auth.RecoverInit)
			ar.Post("/recover/complete", d.Auth.RecoverComplete)

			// PR-NOTIFY: şifre sıfırlama (self-service, e-posta ile).
			// forgot-password: her zaman 200 OK (email enumeration koruması).
			// reset-password: token doğrula + yeni şifre + yeni keypair.
			ar.With(authBruteRL.Middleware).Post("/forgot-password", d.Auth.ForgotPassword)
			ar.With(authBruteRL.Middleware).Post("/reset-password", d.Auth.ResetPassword)

			// PR-SEC4: WebAuthn / FIDO2 credential management + login flow.
			// Registration requires an access token (authenticated user adding a key).
			// Login flow is unauthenticated (begin/finish replace the password step).
			ar.With(requireAuth).Post("/webauthn/register/begin", d.Auth.WebAuthnRegisterBegin)
			ar.With(requireAuth).Post("/webauthn/register/finish", d.Auth.WebAuthnRegisterFinish)
			ar.With(authBruteRL.Middleware).Post("/webauthn/login/begin", d.Auth.WebAuthnLoginBegin)
			ar.With(authBruteRL.Middleware).Post("/webauthn/login/finish", d.Auth.WebAuthnLoginFinish)
			ar.With(requireAuth).Get("/webauthn/credentials", d.Auth.WebAuthnListCredentials)
			ar.With(requireAuth).Put("/webauthn/credentials/{id}", d.Auth.WebAuthnUpdateCredential)
			ar.With(requireAuth).Delete("/webauthn/credentials/{id}", d.Auth.WebAuthnDeleteCredential)

			// Trusted device management (PR-F2b) — access-token protected.
			ar.With(requireAuth).Get("/trusted-devices", d.Auth.ListTrustedDevices)
			ar.With(requireAuth).Delete("/trusted-devices", d.Auth.RevokeAllTrustedDevices)
			ar.With(requireAuth).Delete("/trusted-devices/{id}", d.Auth.RevokeTrustedDevice)
		})
	}

	// PR-LDAP: SSO/LDAP login routes (public, rate-limited).
	// GET  /api/v1/auth/sso/providers         — list enabled providers (login page)
	// POST /api/v1/auth/ldap/login            — LDAP credential exchange
	// GET  /api/v1/auth/sso/{id}/authorize    — OIDC authorize redirect
	// GET  /api/v1/auth/sso/{id}/callback     — OIDC token callback (browser redirect)
	if d.Auth != nil {
		authBruteRLSSO := NewIPRateLimiter(rate.Every(12*time.Second), 5)
		r.With(timeoutMW).Get("/api/v1/auth/sso/providers", d.Auth.ListSSOProviders)
		r.With(timeoutMW, authBruteRLSSO.Middleware).Post("/api/v1/auth/ldap/login", d.Auth.LDAPLogin)
		r.With(timeoutMW).Get("/api/v1/auth/sso/{provider_id}/authorize", d.Auth.OIDCAuthorize)
		// Callback has NO timeout — it does a network round-trip to the OIDC token endpoint.
		r.Get("/api/v1/auth/sso/{provider_id}/callback", d.Auth.OIDCCallback)
	}

	// Inventory routes — folder + item. Bearer access required.
	if d.Folder != nil && d.Auth != nil {
		r.Route("/api/v1/folders", func(fr chi.Router) {
			fr.Use(timeoutMW)
			fr.Use(requireAuth)
			fr.Get("/", d.Folder.List)
			fr.Post("/", d.Folder.Create)
			fr.Get("/{id}", d.Folder.Get)
			fr.Put("/{id}", d.Folder.Update)
			fr.Delete("/{id}", d.Folder.Delete)
			fr.Post("/{id}/permissions", d.Folder.GrantPermission)
			fr.Delete("/{id}/permissions/{user_id}", d.Folder.RevokePermission)
		})
	}

	if d.Item != nil && d.Auth != nil {
		r.Route("/api/v1/items", func(ir chi.Router) {
			ir.Use(timeoutMW)
			ir.Use(requireAuth)
			ir.Get("/", d.Item.List)
			ir.Get("/search", d.Item.Search)                 // PR-SEARCH: cross-folder substring search
			ir.Get("/duplicates", d.Item.CheckDuplicates)    // PR-DUP: duplicate name detection
			ir.Get("/health-report", d.Item.GetHealthReport) // PR-HEALTH: admin health report
			ir.Post("/", d.Item.Create)
			ir.Get("/{id}", d.Item.Get)
			ir.Put("/{id}", d.Item.Update)
			ir.Delete("/{id}", d.Item.Delete)
			ir.Get("/{id}/shares", d.Item.ListShares) // PR-GROUP-SHARE
			ir.Post("/{id}/shares", d.Item.Share)
			ir.Delete("/{id}/shares/{user_id}", d.Item.Unshare)
			ir.Post("/{id}/group-shares", d.Item.ShareGroup)                         // PR-GROUP-SHARE
			ir.Delete("/{id}/group-shares/{group_id}", d.Item.UnshareGroup)          // PR-GROUP-SHARE
			ir.Post("/{id}/rotate", d.Item.RecordRotation)                           // PR-N1
			ir.Get("/{id}/fields/{field_def_id}/versions", d.Item.ListFieldVersions) // PR-N2
			ir.Get("/{id}/links", d.Item.ListLinks)                                  // PR-LINK
			ir.Post("/{id}/links", d.Item.CreateLink)                                // PR-LINK
			ir.Delete("/{id}/links/{link_id}", d.Item.DeleteLink)                    // PR-LINK
			ir.Get("/{id}/health", d.Item.GetHealth)                                 // PR-HEALTH

			// PR-N7 tag + favorite routes under /items/{id}
			if d.Tag != nil {
				ir.Get("/{id}/tags", d.Tag.ListItemTags)
				ir.Post("/{id}/tags", d.Tag.AddItemTag)
				ir.Delete("/{id}/tags/{tag_id}", d.Tag.RemoveItemTag)
				ir.Get("/{id}/favorite", d.Tag.IsFavorite)
				ir.Post("/{id}/favorite", d.Tag.AddFavorite)
				ir.Delete("/{id}/favorite", d.Tag.RemoveFavorite)
			}

			if d.Attachment != nil {
				ir.Get("/{id}/attachments", d.Attachment.List)
				ir.Post("/{id}/attachments", d.Attachment.InitUpload)
				ir.Post("/{id}/attachments/{att_id}/confirm", d.Attachment.ConfirmUpload)
				ir.Get("/{id}/attachments/{att_id}/url", d.Attachment.GetDownloadURL)
				ir.Delete("/{id}/attachments/{att_id}", d.Attachment.Delete)
			}
		})
	}

	// Admin routes — admin role required (RBAC middleware enforces).
	if d.Admin != nil && d.Auth != nil {
		r.Route("/api/v1/admin", func(ar chi.Router) {
			ar.Use(timeoutMW)
			ar.Use(requireAuth)
			ar.Use(RequireRole(RoleAdmin))
			ar.Get("/users", d.Admin.ListUsers)
			ar.Post("/users", d.Admin.CreateUser)
			ar.Post("/users/{id}/disable", d.Admin.DisableUser)
			ar.Post("/users/{id}/enable", d.Admin.EnableUser)
			ar.Post("/users/{id}/roles", d.Admin.GrantRole)
			ar.Delete("/users/{id}/roles/{role_name}", d.Admin.RevokeRole)
			ar.Get("/audit-log", d.Admin.QueryAuditLog)
			// Admin TOTP reset (PR-F2a).
			ar.Post("/users/{id}/totp/reset", d.Admin.AdminResetTOTP)
			// Admin TOTP zorunluluğu toggle (PR-SEC1).
			ar.Patch("/users/{id}/totp-required", d.Admin.SetTOTPRequired)
			// Admin WebAuthn zorunluluğu toggle (PR-SEC4).
			ar.Patch("/users/{id}/webauthn-required", d.Admin.SetWebAuthnRequired)
			// IP kısıtlamaları (PR-SEC5).
			ar.Get("/users/{id}/ip-restrictions", d.Admin.GetIPRestrictions)
			ar.Patch("/users/{id}/ip-restrictions", d.Admin.SetIPRestrictions)
			// Break-glass toggle (PR-N4).
			ar.Post("/users/{id}/break-glass", d.Admin.SetBreakGlass)
			// Export (PR-Export) — registered inside this block so auth/role MW applies.
			if d.Export != nil {
				ar.Get("/export", d.Export.Export)
				// PR-EXPORT: Encrypted ZIP export for disaster recovery.
				ar.Post("/export/encrypted", d.Export.ExportEncrypted)
			}
			// Client certificate management (PR-SEC3).
			if d.ClientCert != nil {
				ar.Get("/client-cert-cas", d.ClientCert.ListCAs)
				ar.Post("/client-cert-cas", d.ClientCert.UploadCA)
				ar.Delete("/client-cert-cas/{ca_id}", d.ClientCert.DeleteCA)
				ar.Get("/users/{id}/client-certs", d.ClientCert.ListUserCerts)
				ar.Post("/users/{id}/client-certs/issue", d.ClientCert.IssueCert)
				ar.Post("/users/{id}/client-certs/register", d.ClientCert.RegisterCert)
				ar.Delete("/users/{id}/client-certs/{cert_id}", d.ClientCert.RevokeCert)
				ar.Patch("/users/{id}/cert-required", d.ClientCert.SetCertRequired)
			}
			// Log forwarding management (PR-LOG1).
			if d.LogForwarding != nil {
				ar.Get("/log-forwarding", d.LogForwarding.ListConfigs)
				ar.Post("/log-forwarding", d.LogForwarding.CreateConfig)
				ar.Put("/log-forwarding/{id}", d.LogForwarding.UpdateConfig)
				ar.Delete("/log-forwarding/{id}", d.LogForwarding.DeleteConfig)
				ar.Post("/log-forwarding/{id}/test", d.LogForwarding.TestConfig)
			}
			// SSO/LDAP provider management (PR-LDAP).
			if d.SSO != nil {
				ar.Get("/sso/providers", d.SSO.ListSSOProviders)
				ar.Post("/sso/providers", d.SSO.CreateSSOProvider)
				ar.Put("/sso/providers/{id}", d.SSO.UpdateSSOProvider)
				ar.Delete("/sso/providers/{id}", d.SSO.DeleteSSOProvider)
				ar.Post("/sso/providers/{id}/test", d.SSO.TestLDAPConnection)
			}
			// Kubernetes cluster management (PR-K8S).
			if d.K8sCluster != nil {
				ar.Get("/k8s/clusters", d.K8sCluster.ListClusters)
				ar.Post("/k8s/clusters", d.K8sCluster.CreateCluster)
				ar.Put("/k8s/clusters/{id}", d.K8sCluster.UpdateCluster)
				ar.Delete("/k8s/clusters/{id}", d.K8sCluster.DeleteCluster)
				ar.Post("/k8s/clusters/{id}/test", d.K8sCluster.TestCluster)
			}
			// HTML report generation (PR-K8S) — long timeout (120s for multi-cluster fetches).
			if d.Report != nil {
				ar.With(middleware.Timeout(120*time.Second)).
					Post("/reports/generate", d.Report.Generate)
			}
		})
	}

	// Group routes — admin only (PR-F6a).
	if d.Group != nil && d.Auth != nil {
		r.Route("/api/v1/admin/groups", func(gr chi.Router) {
			gr.Use(timeoutMW)
			gr.Use(requireAuth)
			gr.Use(RequireRole(RoleAdmin))
			gr.Get("/", d.Group.ListGroups)
			gr.Post("/", d.Group.CreateGroup)
			gr.Get("/{id}", d.Group.GetGroup)
			gr.Delete("/{id}", d.Group.DeleteGroup)
			gr.Get("/{id}/members", d.Group.ListGroupMembers)
			gr.Post("/{id}/members", d.Group.AddGroupMember)
			gr.Delete("/{id}/members/{user_id}", d.Group.RemoveGroupMember)
			gr.Post("/{id}/folder-permissions", d.Group.GrantFolderGroupPermission)
			gr.Delete("/{id}/folder-permissions/{folder_id}", d.Group.RevokeFolderGroupPermission)
		})
	}

	// Tag + favorites routes (PR-N7).
	if d.Tag != nil && d.Auth != nil {
		r.Route("/api/v1/tags", func(tr chi.Router) {
			tr.Use(timeoutMW)
			tr.Use(requireAuth)
			tr.Get("/", d.Tag.ListTags)
			tr.Post("/", d.Tag.CreateTag)
			tr.Delete("/{tag_id}", d.Tag.DeleteTag)
		})
		r.Route("/api/v1/favorites", func(fr chi.Router) {
			fr.Use(timeoutMW)
			fr.Use(requireAuth)
			fr.Get("/", d.Tag.ListFavorites)
		})
	}

	// Annotation routes (PR-DP01) — Backstage-style item metadata annotations.
	if d.Annotation != nil && d.Item != nil && d.Auth != nil {
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/items/{id}/annotations", d.Annotation.ListAnnotations)
		r.With(timeoutMW, requireAuth).
			Put("/api/v1/items/{id}/annotations/{key}", d.Annotation.UpsertAnnotation)
		r.With(timeoutMW, requireAuth).
			Delete("/api/v1/items/{id}/annotations/{key}", d.Annotation.DeleteAnnotation)
	}

	// Portal template routes (PR-DP11) — Golden Path scaffold blueprints.
	// GET: all authenticated users; POST/PUT/DELETE: admin only.
	if d.PortalTemplate != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		mwAdmin := []func(http.Handler) http.Handler{timeoutMW, requireAuth, RequireRole(RoleAdmin)}
		r.With(mw...).Get("/api/v1/portal-templates", d.PortalTemplate.ListPortalTemplates)
		r.With(mw...).Get("/api/v1/portal-templates/{id}", d.PortalTemplate.GetPortalTemplate)
		r.With(mwAdmin...).Post("/api/v1/portal-templates", d.PortalTemplate.CreatePortalTemplate)
		r.With(mwAdmin...).Put("/api/v1/portal-templates/{id}", d.PortalTemplate.UpdatePortalTemplate)
		r.With(mwAdmin...).Delete("/api/v1/portal-templates/{id}", d.PortalTemplate.DeletePortalTemplate)
	}

	// Graph routes (PR-F5a) — pipeline relationship map.
	if d.Graph != nil && d.Auth != nil {
		r.Route("/api/v1/graph", func(gr chi.Router) {
			gr.Use(timeoutMW)
			gr.Use(requireAuth)
			gr.Get("/", d.Graph.Graph)
		})
		// Relationship CRUD lives under /items/{id}/relationships.
		// Mounted here (after item group) to avoid chi route conflicts.
		if d.Item != nil {
			r.With(timeoutMW, requireAuth).
				Post("/api/v1/items/{id}/relationships", d.Graph.AddRelationship)
			r.With(timeoutMW, requireAuth).
				Delete("/api/v1/items/{id}/relationships/{target_id}/{rel_type}", d.Graph.DeleteRelationship)
		}
	}

	// Lifecycle stage routes (PR-F5c) — DevOps lifecycle categorization.
	if d.Lifecycle != nil && d.Auth != nil {
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/lifecycle-stages", d.Lifecycle.ListStages)
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/items/{id}/lifecycle-stages", d.Lifecycle.GetItemStages)
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/items/{id}/lifecycle-stages", d.Lifecycle.SetItemStages)
	}

	// Pipeline diagram routes (PR-F5d).
	if d.Pipeline != nil && d.Auth != nil {
		r.Route("/api/v1/pipeline-diagrams", func(pr chi.Router) {
			pr.Use(timeoutMW)
			pr.Use(requireAuth)
			pr.Get("/", d.Pipeline.ListDiagrams)
			pr.Post("/", d.Pipeline.CreateDiagram)
			pr.Get("/{id}", d.Pipeline.GetDiagram)
			pr.Put("/{id}", d.Pipeline.UpdateDiagram)
			pr.Delete("/{id}", d.Pipeline.DeleteDiagram)
			pr.Post("/{id}/nodes", d.Pipeline.AddNodes)
			pr.Delete("/{id}/nodes/{item_id}", d.Pipeline.RemoveNode)
			pr.Put("/{id}/layout", d.Pipeline.SaveLayout)
			pr.Get("/{id}/graph", d.Pipeline.DiagramGraph)
		})
	}

	// Import routes (PR-IMPORT).
	if d.Item != nil && d.Auth != nil {
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/import/csv/preview", d.Item.CSVPreview)
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/import/batch", d.Item.BatchImport)
	}

	// Onay/Checkout Workflow routes (PR-N3).
	if d.Item != nil && d.Auth != nil {
		// Per-item: create request + approval toggle (admin).
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/items/{id}/access-requests", d.Item.CreateAccessRequest)
		r.With(timeoutMW, requireAuth).
			Patch("/api/v1/items/{id}/approval-required", d.Item.ToggleApprovalRequired)
		// Global: list + approve/deny/cancel.
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/access-requests", d.Item.ListAccessRequests)
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/access-requests/{req_id}/approve", d.Item.ApproveAccessRequest)
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/access-requests/{req_id}/deny", d.Item.DenyAccessRequest)
		r.With(timeoutMW, requireAuth).
			Delete("/api/v1/access-requests/{req_id}", d.Item.CancelAccessRequest)
	}

	// Notification routes (PR-N8 + PR-NOTIFY channels).
	if d.Notification != nil && d.Auth != nil {
		r.Route("/api/v1/notifications", func(nr chi.Router) {
			nr.Use(timeoutMW)
			nr.Use(requireAuth)
			nr.Get("/", d.Notification.List)
			nr.Get("/unread-count", d.Notification.UnreadCount)
			nr.Post("/read-all", d.Notification.MarkAllRead)
			nr.Post("/{id}/read", d.Notification.MarkRead)
		})

		// PR-NOTIFY: per-user notification preferences + external channels.
		r.Route("/api/v1/users/me", func(mr chi.Router) {
			mr.Use(timeoutMW)
			mr.Use(requireAuth)
			mr.Get("/notification-prefs", d.Notification.GetNotificationPrefs)
			mr.Put("/notification-prefs", d.Notification.UpdateNotificationPrefs)
			mr.Get("/channels", d.Notification.ListExternalChannels)
			mr.Post("/channels", d.Notification.AddExternalChannel)
			mr.Delete("/channels/{channel_id}", d.Notification.DeleteExternalChannel)
			mr.Post("/channels/{channel_id}/test", d.Notification.TestExternalChannel)
			// E2E keypair endpoint — must live here because r.Route("/api/v1/users/me")
			// captures the prefix; a separate r.Get("/api/v1/users/me/keypair") outside
			// this block would 404 due to chi's sub-router isolation.
			if d.Catalog != nil {
				mr.Get("/keypair", d.Catalog.GetMyKeypair)
			}
		})
	}

	// Share link routes (PR-N5).
	// Authenticated CRUD lives under /items/{id}/share-links (write-perm check
	// is inside the handler). The public view endpoint has NO auth middleware —
	// anyone with the token can access it.
	if d.ShareLink != nil && d.Auth != nil {
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/items/{id}/share-links", d.ShareLink.CreateShareLink)
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/items/{id}/share-links", d.ShareLink.ListShareLinks)
		r.With(timeoutMW, requireAuth).
			Delete("/api/v1/items/{id}/share-links/{link_id}", d.ShareLink.RevokeShareLink)
	}
	if d.ShareLink != nil {
		// Public — no auth. token_hash lookup + view_count enforcement inside handler.
		r.With(timeoutMW).Get("/api/v1/share/{token}", d.ShareLink.ViewShareLink)
	}

	// Catalog routes — read-only lookup tables for the form/share flows.
	// Note: /users/me/keypair moved into the /api/v1/users/me sub-router above
	// to avoid chi route shadowing (sub-router captures the prefix).
	if d.Catalog != nil && d.Auth != nil {
		r.Route("/api/v1", func(cr chi.Router) {
			cr.Use(timeoutMW)
			cr.Use(requireAuth)
			cr.Get("/field-definitions", d.Catalog.ListFieldDefinitions)
			cr.Get("/item-types", d.Catalog.ListItemTypes)
			cr.Get("/users/{id}/public-key", d.Catalog.GetUserPublicKey)
			// PR-DP-E1: direct catalog entity endpoint
			if d.CatalogEntity != nil {
				cr.Get("/catalog/{kind}/{name}", d.CatalogEntity.GetEntity)
			}
		})
	}

	// PR-VAULT: HashiCorp Vault proxy routes (ADR-0007).
	// vault-fetch: any authenticated user with item read permission.
	// vault/paths: admin only (path listing leaks Vault structure).
	if d.Vault != nil && d.Auth != nil {
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/items/{id}/vault-fetch", d.Vault.VaultFetch)
		r.With(timeoutMW, requireAuth).
			Get("/api/v1/vault/paths", d.Vault.VaultListPaths)
		// PR-VAULT-DYN: ephemeral dynamic credential from Vault secrets engine.
		r.With(timeoutMW, requireAuth).
			Post("/api/v1/items/{id}/dynamic-cred", d.Vault.IssueDynamicCred)
		r.With(timeoutMW, requireAuth).
			Delete("/api/v1/items/{id}/dynamic-cred/{lease_id}", d.Vault.RevokeDynamicCred)
	}

	// PR-TPL: User-defined item templates. Any authenticated user can read/create;
	// only owner or admin can update/delete.
	if d.Template != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		r.With(mw...).Get("/api/v1/templates", d.Template.List)
		r.With(mw...).Post("/api/v1/templates", d.Template.Create)
		r.With(mw...).Put("/api/v1/templates/{id}", d.Template.Update)
		r.With(mw...).Delete("/api/v1/templates/{id}", d.Template.Delete)
	}

	// PR-AI: AI suggestion routes.
	if d.AISuggestion != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		r.With(mw...).Post("/api/v1/items/{id}/suggest", d.AISuggestion.Suggest)
		r.With(mw...).Get("/api/v1/items/{id}/suggestions", d.AISuggestion.ListSuggestions)
		r.With(mw...).Post("/api/v1/items/{id}/suggestions/{sid}/accept", d.AISuggestion.AcceptSuggestion)
		r.With(mw...).Post("/api/v1/items/{id}/suggestions/{sid}/reject", d.AISuggestion.RejectSuggestion)
	}

	// PR-ANSIBLE: Ansible dynamic inventory + API token management.
	if d.Ansible != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		// Ansible inventory: also accepts raw API token (checked inside handler).
		r.With(mw...).Get("/api/v1/ansible/inventory", d.Ansible.GetInventory)
	}
	if d.APIToken != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		r.With(mw...).Get("/api/v1/users/me/api-tokens", d.APIToken.ListAPITokens)
		r.With(mw...).Post("/api/v1/users/me/api-tokens", d.APIToken.CreateAPIToken)
		r.With(mw...).Delete("/api/v1/users/me/api-tokens/{id}", d.APIToken.DeleteAPIToken)
	}

	// PR-K8S: Per-item live K8s proxy routes. Read permission sufficient for data;
	// write permission required for binding registration.
	if d.K8s != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		r.With(mw...).Get("/api/v1/items/{id}/k8s/binding", d.K8s.GetBinding)
		r.With(mw...).Post("/api/v1/items/{id}/k8s/bind", d.K8s.SetBinding)
		r.With(mw...).Get("/api/v1/items/{id}/k8s/pods", d.K8s.ListPods)
		r.With(mw...).Get("/api/v1/items/{id}/k8s/deployments", d.K8s.ListDeployments)
		r.With(mw...).Get("/api/v1/items/{id}/k8s/services", d.K8s.ListServices)
		r.With(mw...).Get("/api/v1/items/{id}/k8s/events", d.K8s.ListEvents)
		r.With(mw...).Get("/api/v1/items/{id}/k8s/metrics", d.K8s.ListMetrics)
	}

	// PR-SCAN: Secret fingerprint scanning endpoints.
	// Item-level CRUD: JWT auth (standard).
	// POST /security/scan: JWT OR API token (scope='scan'/'read'). No JWT MW applied — handled inside handler.
	if d.Scan != nil && d.Auth != nil {
		mw := []func(http.Handler) http.Handler{timeoutMW, requireAuth}
		r.With(mw...).Put("/api/v1/items/{id}/scan", d.Scan.UpsertFingerprint)
		r.With(mw...).Get("/api/v1/items/{id}/scan", d.Scan.GetScanConfig)
		r.With(mw...).Delete("/api/v1/items/{id}/scan/{fp_id}", d.Scan.DeleteFingerprint)
		// Scan endpoint: no JWT MW, handler authenticates itself (JWT or API token).
		r.With(timeoutMW).Post("/api/v1/security/scan", d.Scan.ScanContent)
		r.With(mw...).Get("/api/v1/security/scan-detections", d.Scan.ListDetections)
		r.With(mw...).Post("/api/v1/security/scan-detections/{id}/acknowledge", d.Scan.AcknowledgeDetection)
	}

	// PR-SCIM: SCIM 2.0 provisioning endpoints.
	// Auth: Bearer API token with scope='scim' (checked inside handlers).
	// Base path: /scim/v2/ — separate from /api/v1/ so IdPs can configure it cleanly.
	// ServiceProviderConfig is unauthenticated (IdP reads it during setup).
	if d.SCIM != nil {
		r.With(timeoutMW).Get("/scim/v2/ServiceProviderConfig", d.SCIM.GetServiceProviderConfig)
		r.Route("/scim/v2", func(sr chi.Router) {
			sr.Use(timeoutMW)
			sr.Get("/Users", d.SCIM.ListUsers)
			sr.Post("/Users", d.SCIM.CreateUser)
			sr.Get("/Users/{id}", d.SCIM.GetUser)
			sr.With(middleware.AllowContentType("application/scim+json", "application/json")).
				Patch("/Users/{id}", d.SCIM.PatchUser)
			sr.Delete("/Users/{id}", d.SCIM.DeleteUser)
			sr.Get("/Groups", d.SCIM.ListGroups)
			sr.Post("/Groups", d.SCIM.CreateGroup)
			sr.Get("/Groups/{id}", d.SCIM.GetGroup)
			sr.With(middleware.AllowContentType("application/scim+json", "application/json")).
				Patch("/Groups/{id}", d.SCIM.PatchGroup)
		})
	}

	return r
}

// echoRequestIDHeader copies the request ID (set by chi.RequestID into the
// request context) onto the response as `X-Request-Id`. This must be set
// before any handler writes the status, so the middleware runs early.
func echoRequestIDHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rid := middleware.GetReqID(r.Context()); rid != "" {
			w.Header().Set("X-Request-Id", rid)
		}
		next.ServeHTTP(w, r)
	})
}

// slogRequestLogger emits one log line per request. Liveness/readiness
// probes are filtered out to avoid log spam (k8s polls these constantly).
func slogRequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip noisy probes
			switch r.URL.Path {
			case "/healthz", "/readyz":
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			logger.Info("http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Duration("duration", time.Since(start)),
				slog.Int("bytes", ww.BytesWritten()),
				slog.String("request_id", middleware.GetReqID(r.Context())),
				slog.String("remote_ip", r.RemoteAddr),
			)
		})
	}
}
