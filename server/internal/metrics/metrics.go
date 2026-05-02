// Package metrics registers Prometheus metrics and provides a chi middleware
// and HTTP handler for the /metrics scrape endpoint.
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "envanter_http_requests_total",
		Help: "Total HTTP requests by method, route pattern, and status code.",
	}, []string{"method", "route", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "envanter_http_request_duration_seconds",
		Help:    "HTTP request latency by method and route pattern.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route"})

	// AuthFailuresTotal is incremented by auth handlers on failed attempts.
	// reason labels: bad_password, bad_totp, locked, expired_token, invalid_token
	AuthFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "envanter_auth_failures_total",
		Help: "Authentication and token validation failures.",
	}, []string{"reason"})

	// ItemOpsTotal is incremented by item handlers on successful mutations.
	// op labels: create, update, delete, share, unshare
	ItemOpsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "envanter_item_ops_total",
		Help: "Item CRUD and sharing operations.",
	}, []string{"op"})
)

// Handler returns the Prometheus scrape handler for GET /metrics.
// No authentication — restrict access at the network layer (NetworkPolicy).
func Handler() http.Handler {
	return promhttp.Handler()
}

// Middleware records per-request duration and count.
// Must be added after chi's RequestID middleware so ww.Status() is reliable.
// /healthz and /readyz are excluded to avoid scrape noise.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip Kubernetes liveness/readiness probes — high-frequency, low-value.
		switch r.URL.Path {
		case "/healthz", "/readyz", "/metrics":
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		ww := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		// chi's RoutePattern returns the registered pattern (e.g. /api/v1/items/{id})
		// rather than the actual URL, preventing high-cardinality label values.
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unknown"
		}

		status := strconv.Itoa(ww.Status())
		httpRequestsTotal.WithLabelValues(r.Method, route, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
	})
}
