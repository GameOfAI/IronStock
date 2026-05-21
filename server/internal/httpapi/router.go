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
	Logger       *slog.Logger
	DB           DBPinger
	Auth         *AuthHandlers
	Folder       *FolderHandlers
	Item         *ItemHandlers
	Attachment   *AttachmentHandlers
	Admin        *AdminHandlers
	ClientCert   *ClientCertHandlers // PR-SEC3: mTLS client certificate management
	Group        *GroupHandlers
	Catalog      *CatalogHandlers
	WS           *WSHandlers
	Tag          *TagHandlers
	Export       *ExportHandlers
	Notification *NotificationHandlers
	Graph        *GraphHandlers
	ShareLink    *ShareLinkHandlers
	Lifecycle      *LifecycleHandlers
	Pipeline       *PipelineHandlers
	LogForwarding  *LogForwardingHandlers // PR-LOG1: audit log forwarding to syslog/slack
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
		AllowedOrigins: []string{
			"tauri://localhost",
			"http://localhost:1420",
			"https://localhost:1420",
			"http://localhost",
			"https://localhost",
		},
		AllowOriginFunc:  func(_ *http.Request, _ string) bool { return true },
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

	// Health + metrics routes (unauthenticated, NOT timeout-wrapped)
	h := &handlers{deps: d}
	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)
	// /metrics is internal-only; restricted at the network layer (NetworkPolicy).
	r.Get("/metrics", metrics.Handler().ServeHTTP)

	// WebSocket routes.
	// GET /ws must be mounted BEFORE timeout-wrapped groups; the long-lived
	// connection must not be wrapped by http.TimeoutHandler.
	// POST /ws/ticket is a short REST call — it IS timeout-wrapped.
	if d.WS != nil {
		r.Get("/api/v1/ws", d.WS.Connect)
		// Ticket endpoint: short-lived, subject to timeout + auth middleware.
		// d.Auth is always non-nil when d.WS is non-nil (main.go wires both together).
		if d.Auth != nil {
			r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
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

			// Trusted device management (PR-F2b) — access-token protected.
			ar.With(RequireAccessToken(d.Auth.Service.JWT)).Get("/trusted-devices", d.Auth.ListTrustedDevices)
			ar.With(RequireAccessToken(d.Auth.Service.JWT)).Delete("/trusted-devices", d.Auth.RevokeAllTrustedDevices)
			ar.With(RequireAccessToken(d.Auth.Service.JWT)).Delete("/trusted-devices/{id}", d.Auth.RevokeTrustedDevice)
		})
	}

	// Inventory routes — folder + item. Bearer access required.
	if d.Folder != nil && d.Auth != nil {
		r.Route("/api/v1/folders", func(fr chi.Router) {
			fr.Use(timeoutMW)
			fr.Use(RequireAccessToken(d.Auth.Service.JWT))
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
			ir.Use(RequireAccessToken(d.Auth.Service.JWT))
			ir.Get("/", d.Item.List)
			ir.Post("/", d.Item.Create)
			ir.Get("/{id}", d.Item.Get)
			ir.Put("/{id}", d.Item.Update)
			ir.Delete("/{id}", d.Item.Delete)
			ir.Post("/{id}/shares", d.Item.Share)
			ir.Delete("/{id}/shares/{user_id}", d.Item.Unshare)
			ir.Post("/{id}/rotate", d.Item.RecordRotation)                           // PR-N1
			ir.Get("/{id}/fields/{field_def_id}/versions", d.Item.ListFieldVersions) // PR-N2

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
			ar.Use(RequireAccessToken(d.Auth.Service.JWT))
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
			// Break-glass toggle (PR-N4).
			ar.Post("/users/{id}/break-glass", d.Admin.SetBreakGlass)
			// Export (PR-Export) — registered inside this block so auth/role MW applies.
			if d.Export != nil {
				ar.Get("/export", d.Export.Export)
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
		})
	}

	// Group routes — admin only (PR-F6a).
	if d.Group != nil && d.Auth != nil {
		r.Route("/api/v1/admin/groups", func(gr chi.Router) {
			gr.Use(timeoutMW)
			gr.Use(RequireAccessToken(d.Auth.Service.JWT))
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
			tr.Use(RequireAccessToken(d.Auth.Service.JWT))
			tr.Get("/", d.Tag.ListTags)
			tr.Post("/", d.Tag.CreateTag)
			tr.Delete("/{tag_id}", d.Tag.DeleteTag)
		})
		r.Route("/api/v1/favorites", func(fr chi.Router) {
			fr.Use(timeoutMW)
			fr.Use(RequireAccessToken(d.Auth.Service.JWT))
			fr.Get("/", d.Tag.ListFavorites)
		})
	}

	// Graph routes (PR-F5a) — pipeline relationship map.
	if d.Graph != nil && d.Auth != nil {
		r.Route("/api/v1/graph", func(gr chi.Router) {
			gr.Use(timeoutMW)
			gr.Use(RequireAccessToken(d.Auth.Service.JWT))
			gr.Get("/", d.Graph.Graph)
		})
		// Relationship CRUD lives under /items/{id}/relationships.
		// Mounted here (after item group) to avoid chi route conflicts.
		if d.Item != nil {
			r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
				Post("/api/v1/items/{id}/relationships", d.Graph.AddRelationship)
			r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
				Delete("/api/v1/items/{id}/relationships/{target_id}/{rel_type}", d.Graph.DeleteRelationship)
		}
	}

	// Lifecycle stage routes (PR-F5c) — DevOps lifecycle categorization.
	if d.Lifecycle != nil && d.Auth != nil {
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Get("/api/v1/lifecycle-stages", d.Lifecycle.ListStages)
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Get("/api/v1/items/{id}/lifecycle-stages", d.Lifecycle.GetItemStages)
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Post("/api/v1/items/{id}/lifecycle-stages", d.Lifecycle.SetItemStages)
	}

	// Pipeline diagram routes (PR-F5d).
	if d.Pipeline != nil && d.Auth != nil {
		r.Route("/api/v1/pipeline-diagrams", func(pr chi.Router) {
			pr.Use(timeoutMW)
			pr.Use(RequireAccessToken(d.Auth.Service.JWT))
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

	// Notification routes (PR-N8).
	if d.Notification != nil && d.Auth != nil {
		r.Route("/api/v1/notifications", func(nr chi.Router) {
			nr.Use(timeoutMW)
			nr.Use(RequireAccessToken(d.Auth.Service.JWT))
			nr.Get("/", d.Notification.List)
			nr.Get("/unread-count", d.Notification.UnreadCount)
			nr.Post("/read-all", d.Notification.MarkAllRead)
			nr.Post("/{id}/read", d.Notification.MarkRead)
		})
	}

	// Share link routes (PR-N5).
	// Authenticated CRUD lives under /items/{id}/share-links (write-perm check
	// is inside the handler). The public view endpoint has NO auth middleware —
	// anyone with the token can access it.
	if d.ShareLink != nil && d.Auth != nil {
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Post("/api/v1/items/{id}/share-links", d.ShareLink.CreateShareLink)
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Get("/api/v1/items/{id}/share-links", d.ShareLink.ListShareLinks)
		r.With(timeoutMW, RequireAccessToken(d.Auth.Service.JWT)).
			Delete("/api/v1/items/{id}/share-links/{link_id}", d.ShareLink.RevokeShareLink)
	}
	if d.ShareLink != nil {
		// Public — no auth. token_hash lookup + view_count enforcement inside handler.
		r.With(timeoutMW).Get("/api/v1/share/{token}", d.ShareLink.ViewShareLink)
	}

	// Catalog routes — read-only lookup tables for the form/share flows
	// + /users/me/keypair (caller's own E2E material for KEK derive).
	// Any authenticated user may read these.
	if d.Catalog != nil && d.Auth != nil {
		r.Route("/api/v1", func(cr chi.Router) {
			cr.Use(timeoutMW)
			cr.Use(RequireAccessToken(d.Auth.Service.JWT))
			cr.Get("/field-definitions", d.Catalog.ListFieldDefinitions)
			cr.Get("/item-types", d.Catalog.ListItemTypes)
			cr.Get("/users/me/keypair", d.Catalog.GetMyKeypair)
			cr.Get("/users/{id}/public-key", d.Catalog.GetUserPublicKey)
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
