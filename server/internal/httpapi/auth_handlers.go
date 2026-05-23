package httpapi

import (
	"log/slog"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/email"
	"envanter.app/server/internal/notify"
	webauthnpkg "envanter.app/server/internal/webauthn"
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

	// PR-NOTIFY: E-posta gönderimi için SMTP client (nil ise e-posta gönderilemez).
	EmailClient *email.Client
	// AppURL, frontend public URL'si — reset link oluşturmak için.
	AppURL string
	// PasswordResetTTL, token geçerlilik süresi (dakika). 0 ise 60 kullanılır.
	PasswordResetTTL int

	// PR-SEC4: WebAuthn / FIDO2 / YubiKey support. nil if not configured.
	WebAuthn *webauthnpkg.WAService
}
