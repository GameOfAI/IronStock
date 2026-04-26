package auth

// Session-table accessors. Kept in the auth package (not internal/db/sqlcgen)
// because they're tiny, performance-critical, and live alongside the refresh-
// token primitives that produce/consume their inputs.
//
// Schema reference: server/migrations/00004_sessions.sql
//
//	id                  uuid pk
//	user_id             uuid fk users(id)
//	refresh_token_hash  bytea unique (SHA-256 = 32B)
//	user_agent          text nullable
//	ip_address          inet nullable
//	created_at          timestamptz default now()
//	last_used_at        timestamptz default now()
//	expires_at          timestamptz
//	revoked_at          timestamptz nullable
//	revoke_reason       text nullable (CHECK enum)
//
// Revoke reason enum: 'logout', 'logout_all', 'rotation', 'admin', 'expired',
// 'recovery', 'reuse_detected'. Keep this list mirrored with the SQL CHECK.

import (
	"context"
	"errors"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Revoke reason constants — must match the CHECK constraint in
// migrations/00004_sessions.sql.
const (
	RevokeReasonLogout        = "logout"
	RevokeReasonLogoutAll     = "logout_all"
	RevokeReasonRotation      = "rotation"
	RevokeReasonAdmin         = "admin"
	RevokeReasonExpired       = "expired"
	RevokeReasonRecovery      = "recovery"
	RevokeReasonReuseDetected = "reuse_detected"
)

// SessionRow holds the columns we read for refresh / logout flows.
//
// UserAgent + IPAddress are populated by LookupSessionByRefreshHash so the
// caller can flag session-binding changes (UA/IP drift = audit alarm, not
// a block per auth-flow.md "Session binding").
type SessionRow struct {
	ID           string
	UserID       string
	UserAgent    *string
	IPAddress    *string
	ExpiresAt    time.Time
	RevokedAt    *time.Time // nil if active
	RevokeReason *string    // nil if active
}

// IsActive reports whether the session is currently usable: not revoked AND
// not expired.
func (s SessionRow) IsActive(now time.Time) bool {
	if s.RevokedAt != nil {
		return false
	}
	return s.ExpiresAt.After(now)
}

// DBExec is the minimum interface the session helpers need. Both
// *pgxpool.Pool and pgx.Tx satisfy it, so callers can run inside a
// transaction (e.g. login) or directly against the pool (e.g. /logout).
type DBExec interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// CreateSession inserts a new session row and returns its UUID.
func CreateSession(
	ctx context.Context, q DBExec,
	userID string, refreshHash []byte,
	userAgent string, ipAddr netip.Addr,
	expiresAt time.Time,
) (string, error) {
	const insertSQL = `
		INSERT INTO sessions (
			user_id, refresh_token_hash, user_agent, ip_address, expires_at
		) VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING id::text
	`
	var id string
	err := q.QueryRow(ctx, insertSQL,
		userID,
		refreshHash,
		nullableString(userAgent),
		nullableIP(ipAddr),
		expiresAt,
	).Scan(&id)
	return id, err
}

// LookupSessionByRefreshHash returns the session matching this refresh hash,
// regardless of revocation state. Caller decides what to do based on
// IsActive() + RevokedAt — used by /refresh for reuse detection.
//
// UserAgent + IPAddress (from session creation) are returned so the caller
// can compare against the current request's UA/IP for binding-flag audit.
//
// ip_address is read as text via host(...) cast — pgx scans inet to
// netip.Addr only with extra adapters, but text round-trips losslessly.
//
// Returns pgx.ErrNoRows if no session with this hash exists.
func LookupSessionByRefreshHash(
	ctx context.Context, q DBExec, refreshHash []byte,
) (SessionRow, error) {
	const selectSQL = `
		SELECT id::text, user_id::text, user_agent, host(ip_address),
		       expires_at, revoked_at, revoke_reason
		FROM sessions
		WHERE refresh_token_hash = $1
		LIMIT 1
	`
	var row SessionRow
	err := q.QueryRow(ctx, selectSQL, refreshHash).Scan(
		&row.ID, &row.UserID, &row.UserAgent, &row.IPAddress,
		&row.ExpiresAt, &row.RevokedAt, &row.RevokeReason,
	)
	return row, err
}

// RevokeSession marks a single session row revoked. Idempotent in practice:
// re-revoking with the same reason is a no-op (UPDATE matches no rows since
// the WHERE clause excludes already-revoked rows).
func RevokeSession(ctx context.Context, q DBExec, sessionID, reason string) error {
	if !validRevokeReason(reason) {
		return errors.New("auth: invalid revoke reason")
	}
	const updateSQL = `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $2
		WHERE id = $1::uuid AND revoked_at IS NULL
	`
	_, err := q.Exec(ctx, updateSQL, sessionID, reason)
	return err
}

// RevokeAllUserSessions marks every active session for a user revoked.
// Used by /logout-all, password change, recovery completion, and reuse
// detection.
func RevokeAllUserSessions(ctx context.Context, q DBExec, userID, reason string) error {
	if !validRevokeReason(reason) {
		return errors.New("auth: invalid revoke reason")
	}
	const updateSQL = `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $2
		WHERE user_id = $1::uuid AND revoked_at IS NULL
	`
	_, err := q.Exec(ctx, updateSQL, userID, reason)
	return err
}

// TouchSession updates last_used_at to now. Called on every successful
// refresh so admins can see "last activity" on the devices page.
func TouchSession(ctx context.Context, q DBExec, sessionID string) error {
	const updateSQL = `
		UPDATE sessions
		SET last_used_at = now()
		WHERE id = $1::uuid AND revoked_at IS NULL
	`
	_, err := q.Exec(ctx, updateSQL, sessionID)
	return err
}

func validRevokeReason(r string) bool {
	switch r {
	case RevokeReasonLogout,
		RevokeReasonLogoutAll,
		RevokeReasonRotation,
		RevokeReasonAdmin,
		RevokeReasonExpired,
		RevokeReasonRecovery,
		RevokeReasonReuseDetected:
		return true
	}
	return false
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableIP(a netip.Addr) any {
	if !a.IsValid() {
		return nil
	}
	return a.String()
}
