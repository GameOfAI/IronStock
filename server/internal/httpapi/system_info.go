package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"envanter.app/server/internal/ws"
)

var processStartTime = time.Now()

// SystemInfoHandlers serves GET /api/v1/system/info — authenticated system
// status endpoint for the sidebar health widget.
type SystemInfoHandlers struct {
	DB      DBPinger
	Hub     *ws.Hub
	Logger  *slog.Logger
	Version string
}

type systemInfoResponse struct {
	ServerVersion string `json:"server_version"`
	UptimeSeconds int64  `json:"uptime_seconds"`
	DBStatus      string `json:"db_status"`
	WsConnections int    `json:"ws_connections"`
	OnlineUsers   *int   `json:"online_users,omitempty"`
}

// GetInfo implements GET /api/v1/system/info.
func (h *SystemInfoHandlers) GetInfo(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, nil)
		return
	}

	// DB health check (2s timeout)
	dbStatus := "healthy"
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.DB.Ping(ctx); err != nil {
		dbStatus = "unhealthy"
		h.Logger.Warn("system-info: db ping failed", slog.String("error", err.Error()))
	}

	resp := systemInfoResponse{
		ServerVersion: h.Version,
		UptimeSeconds: int64(time.Since(processStartTime).Seconds()),
		DBStatus:      dbStatus,
		WsConnections: h.Hub.Stats(),
	}

	// Admin-only: online user count
	if hasRole(claims, "admin") {
		n := h.Hub.UniqueUsers()
		resp.OnlineUsers = &n
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}
