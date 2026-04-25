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
)

// DBPinger is the minimum DB interface needed for /readyz.
//
// pgxpool.Pool satisfies this; tests can inject fakes.
type DBPinger interface {
	Ping(ctx context.Context) error
}

// Deps groups dependencies needed for the HTTP layer.
//
// Auth is optional: when nil, /api/v1/auth/* routes are not mounted (useful
// for foundation tests that don't exercise auth flows).
type Deps struct {
	Logger *slog.Logger
	DB     DBPinger
	Auth   *AuthHandlers
}

// NewRouter builds a chi router with the standard middleware stack.
//
// Middleware order is significant — see comments inline.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

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
	// 6. Timeout — overall request budget; handlers should respect ctx
	r.Use(middleware.Timeout(30 * time.Second))

	// Health routes (unauthenticated)
	h := &handlers{deps: d}
	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)

	// Auth routes — only mounted when auth deps are provided.
	if d.Auth != nil {
		r.Route("/api/v1/auth", func(ar chi.Router) {
			ar.Post("/register", d.Auth.Register)
			ar.Post("/totp/init", d.Auth.TOTPInit)
			ar.Post("/totp/verify", d.Auth.TOTPVerify)
			// PR-6: login, refresh, logout, change-password, recover/init, recover/complete
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
