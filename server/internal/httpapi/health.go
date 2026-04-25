package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// handlers carries deps for handler methods.
type handlers struct {
	deps Deps
}

// Healthz is a liveness probe: returns 200 if the process is alive.
// Does not check downstream dependencies — k8s should restart the pod
// only when the process itself is unresponsive.
func (h *handlers) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Readyz is a readiness probe: returns 503 if any dependency
// (DB) is unreachable. k8s should stop routing traffic to this pod
// until ready.
func (h *handlers) Readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := h.deps.DB.Ping(ctx); err != nil {
		h.deps.Logger.Warn("readyz: db unhealthy", slog.String("error", err.Error()))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "unavailable",
			"reason": "db",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// writeJSON writes a JSON response with the given status code.
// Errors during encoding are silent — handlers should not panic on encoding
// failure (the HTTP status is already written).
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
