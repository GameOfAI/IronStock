package httpapi

import (
	"log/slog"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/notify"
	"envanter.app/server/internal/ws"
)

// AuthHandlers groups the bearer-protected and tmp-token-protected handlers
// for /api/v1/auth/*. Constructed once at startup with full deps and bound
// to chi via NewRouter.
type AuthHandlers struct {
	Service          *auth.Service
	Audit            *audit.Writer
	Logger           *slog.Logger
	BootstrapEnabled bool // mirrors config.BootstrapEnabled — gates /auth/bootstrap

	// Break-glass alerting (PR-N4): optional — nil disables WS/notification fanout.
	Hub    *ws.Hub
	Notify *notify.Writer
}
