// Package audit writes audit log entries to the audit_log table.
//
// Audit entries are server-side plaintext for compliance and incident response
// (ADR-0002 §1). Callers MUST never put secret material in the details field;
// reference secrets only by metadata keys (e.g., {"field":"password"} not
// {"value":"hunter2"}).
package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Action constants — keep these dot-namespaced and exhaustive for grep-ability.
const (
	ActionAuthRegister     = "auth.register"
	ActionAuthTOTPInit     = "auth.totp_init"
	ActionAuthTOTPVerified = "auth.totp_verified"
	ActionAuthLogin        = "auth.login"
	ActionAuthLoginFail    = "auth.login_fail"
	ActionAuthLogout       = "auth.logout"
	ActionAuthLogoutAll    = "auth.logout_all"
	ActionAuthRefresh      = "auth.refresh"
	ActionAuthRefreshReuse = "auth.refresh_reuse_detected"
	ActionAuthPwdChanged   = "auth.password_changed"
	ActionAuthRecover      = "auth.recover"
	ActionAuthRecoverFail  = "auth.recover_fail"

	// ActionAuthSessionBindingChanged is emitted on /refresh when the
	// User-Agent or IP differs from the row stored at session creation.
	// Informational only — we do not block the refresh.
	ActionAuthSessionBindingChanged = "auth.session_binding_changed"
)

// Resource type constants.
const (
	ResourceUser    = "user"
	ResourceSession = "session"
	ResourceItem    = "item"
)

// Entry is one audit_log row.
type Entry struct {
	// ActorUserID is the acting user's UUID, or empty for system actions.
	ActorUserID string
	Action      string
	// ResourceType + ResourceID identify the affected row, both optional.
	ResourceType string
	ResourceID   string
	// Details is action-specific structured context. MUST NOT contain secrets.
	Details map[string]any
	// IPAddress is the originating client IP (post X-Forwarded-For trust).
	IPAddress netip.Addr
	UserAgent string
}

// Writer persists audit entries.
type Writer struct {
	db *pgxpool.Pool
}

// NewWriter wraps a connection pool.
func NewWriter(db *pgxpool.Pool) *Writer {
	return &Writer{db: db}
}

// Write inserts an Entry. Best-effort: callers should log but not abort the
// request if audit writing fails (the user-visible action still succeeded).
func (w *Writer) Write(ctx context.Context, e Entry) error {
	if e.Action == "" {
		return errors.New("audit: action is required")
	}
	detailsJSON, err := json.Marshal(e.Details)
	if err != nil {
		return fmt.Errorf("audit: marshal details: %w", err)
	}
	if len(e.Details) == 0 {
		detailsJSON = []byte(`{}`)
	}

	const insertSQL = `
		INSERT INTO audit_log (
			actor_user_id, action, resource_type, resource_id,
			details, ip_address, user_agent
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	args := []any{
		nullUUID(e.ActorUserID),
		e.Action,
		nullString(e.ResourceType),
		nullUUID(e.ResourceID),
		detailsJSON,
		nullAddr(e.IPAddress),
		nullString(e.UserAgent),
	}
	if _, err := w.db.Exec(ctx, insertSQL, args...); err != nil {
		return fmt.Errorf("audit: insert: %w", err)
	}
	return nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullAddr(a netip.Addr) any {
	if !a.IsValid() {
		return nil
	}
	return a.String()
}
