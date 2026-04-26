package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type refreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// Refresh implements POST /api/v1/auth/refresh.
//
// Rotation: every successful refresh produces a new (access, refresh) pair
// AND revokes the previous refresh's session row, replacing it with a new
// one. The old refresh token can never be used again.
//
// Reuse detection: if the presented refresh token matches a session row that
// is ALREADY revoked, somebody is replaying a stolen token (or the legitimate
// client got rolled back). Either way: revoke ALL sessions for that user
// with reason='reuse_detected', emit an audit alarm, and return 401.
//
// On any unauthenticated path (token unknown, expired, etc.) we return the
// generic invalid_credentials envelope. The audit log records the precise
// cause.
func (s *AuthHandlers) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.RefreshToken == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"refresh_token zorunlu.", errors.New("missing refresh_token"))
		return
	}

	ctx := r.Context()
	hash := auth.HashRefresh(req.RefreshToken)

	row, err := auth.LookupSessionByRefreshHash(ctx, s.Service.DB, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Unknown token — could be random garbage, or a token from a
			// session that was hard-deleted. Either way, no user to attribute.
			writeInvalidCreds(w, s.Logger, errors.New("unknown refresh token"))
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum sorgulanamadı.", err)
		return
	}

	now := time.Now()

	// Reuse detection: revoked row hit on lookup.
	if row.RevokedAt != nil {
		_ = auth.RevokeAllUserSessions(ctx, s.Service.DB, row.UserID,
			auth.RevokeReasonReuseDetected)
		_ = s.Audit.Write(ctx, audit.Entry{
			ActorUserID:  row.UserID,
			Action:       audit.ActionAuthRefreshReuse,
			ResourceType: audit.ResourceSession,
			ResourceID:   row.ID,
			Details: map[string]any{
				"original_revoke_reason": ptrStringOrEmpty(row.RevokeReason),
			},
			IPAddress: parseIP(r.RemoteAddr),
			UserAgent: r.UserAgent(),
		})
		writeInvalidCreds(w, s.Logger, errors.New("refresh token reuse detected"))
		return
	}

	// Expired-but-not-revoked is also a hard fail. We don't auto-revoke here
	// because the row will be cleaned by the expiry cron (reason='expired').
	if row.ExpiresAt.Before(now) {
		writeInvalidCreds(w, s.Logger, errors.New("refresh token expired"))
		return
	}

	// All good: rotate. Mark the old row revoked='rotation' and create a
	// new one in the same tx so the old token can never be replayed even
	// if the client retries before the new token reaches it.
	newRefresh, err := auth.GenerateRefresh()
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Refresh token üretilemedi.", err)
		return
	}

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := auth.RevokeSession(ctx, tx, row.ID, auth.RevokeReasonRotation); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Eski oturum revoke edilemedi.", err)
		return
	}

	newSessionID, err := auth.CreateSession(ctx, tx,
		row.UserID, newRefresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr),
		newRefresh.ExpiresAt,
	)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Yeni oturum oluşturulamadı.", err)
		return
	}

	roles, err := fetchUserRoles(ctx, tx, row.UserID)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Roller okunamadı.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	accessToken, err := s.Service.JWT.IssueAccess(row.UserID, newSessionID, roles)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Access token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  row.UserID,
		Action:       audit.ActionAuthRefresh,
		ResourceType: audit.ResourceSession,
		ResourceID:   newSessionID,
		Details: map[string]any{
			"rotated_from": row.ID,
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, refreshResponse{
		AccessToken:  accessToken,
		RefreshToken: newRefresh.Token,
		ExpiresIn:    int(auth.AccessTokenLifetime.Seconds()),
		TokenType:    "Bearer",
	})
}

func ptrStringOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
