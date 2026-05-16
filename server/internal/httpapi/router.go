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
	Logger     *slog.Logger
	DB         DBPinger
	Auth       *AuthHandlers
	Folder     *FolderHandlers
	Item       *ItemHandlers
	Attachment *AttachmentHandlers
	Admin      *AdminHandlers
	Catalog    *CatalogHandlers
	WS         *WSHandlers
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

			// access-token-protected.
			ar.Post("/logout", d.Auth.Logout)
			ar.Post("/logout-all", d.Auth.LogoutAll)
			ar.Post("/change-password", d.Auth.ChangePassword)

			// recovery flow — init is brute-forceable (rate-limit it),
			// complete is tmp-token gated.
			ar.With(authBruteRL.Middleware).Post("/recover/init", d.Auth.RecoverInit)
			ar.Post("/recover/complete", d.Auth.RecoverComplete)
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
		})
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
