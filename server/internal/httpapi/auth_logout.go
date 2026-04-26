package httpapi

import (
	"errors"
	"net/http"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// Logout implements POST /api/v1/auth/logout.
//
// Auth: Bearer access token. The session that backs this access token is
// revoked (revoke_reason='logout'). Idempotent: hitting /logout twice with
// the same already-revoked token is a no-op.
//
// We DON'T require the client to also send the refresh token — the access
// token's `jti` claim is the session UUID, so the server already knows which
// row to revoke. This matches OAuth2 patterns where a single logout button
// invalidates everything.
func (s *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	if err := auth.RevokeSession(ctx, s.Service.DB, claims.ID, auth.RevokeReasonLogout); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum kapatılamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthLogout,
		ResourceType: audit.ResourceSession,
		ResourceID:   claims.ID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// LogoutAll implements POST /api/v1/auth/logout-all.
//
// Revokes every active session for the calling user. Useful after "device
// stolen" alerts or password change. Returns 204.
func (s *AuthHandlers) LogoutAll(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	if err := auth.RevokeAllUserSessions(ctx, s.Service.DB, claims.Subject, auth.RevokeReasonLogoutAll); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturumlar kapatılamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthLogoutAll,
		ResourceType: audit.ResourceUser,
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// requireAccessToken extracts and validates a Bearer access token from
// Authorization. On failure writes the error response and returns ok=false.
//
// Note: this is the inline check used by handlers that don't go through
// the RequireAccessToken middleware (e.g. /logout — we want the audit
// entry on missing-token failures, which the middleware doesn't write).
func (s *AuthHandlers) requireAccessToken(w http.ResponseWriter, r *http.Request) (*auth.Claims, bool) {
	authz := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(authz) <= len(prefix) || authz[:len(prefix)] != prefix {
		writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Authorization header eksik.", errors.New("no bearer"))
		return nil, false
	}
	token := authz[len(prefix):]
	claims, err := s.Service.JWT.Parse(token, auth.PurposeAccess)
	if err != nil {
		writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeInvalidToken,
			"Token geçersiz.", err)
		return nil, false
	}
	return claims, true
}
