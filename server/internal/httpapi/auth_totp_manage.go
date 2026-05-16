package httpapi

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// totpStatusResponse is the body of GET /api/v1/auth/totp/status.
type totpStatusResponse struct {
	Enabled           bool `json:"enabled"`
	RecoveryCodeCount int  `json:"recovery_code_count"`
}

// TOTPStatus implements GET /api/v1/auth/totp/status.
//
// Auth: Bearer access token.
// Returns whether the calling user has a verified TOTP secret, and how many
// recovery codes are still unused.
func (s *AuthHandlers) TOTPStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	ctx := r.Context()

	// Check for a verified TOTP secret.
	var enabled bool
	err := s.Service.DB.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM totp_secrets
			WHERE user_id = $1::uuid AND verified = true
		)`,
		claims.Subject,
	).Scan(&enabled)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP durumu okunamadı.", err)
		return
	}

	// Count remaining recovery codes (used codes are deleted, not marked used).
	var recoveryCodeCount int
	if enabled {
		if err := s.Service.DB.QueryRow(ctx,
			`SELECT count(*) FROM recovery_codes WHERE user_id = $1::uuid`,
			claims.Subject,
		).Scan(&recoveryCodeCount); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Recovery code sayısı okunamadı.", err)
			return
		}
	}

	writeJSON(w, http.StatusOK, totpStatusResponse{
		Enabled:           enabled,
		RecoveryCodeCount: recoveryCodeCount,
	})
}

// totpDisableRequest is the body of DELETE /api/v1/auth/totp.
type totpDisableRequest struct {
	// MasterPassword is required to confirm intent — prevents CSRF / stolen
	// token attacks that could silently downgrade 2FA protection.
	MasterPassword string `json:"master_password"`
}

// TOTPDisable implements DELETE /api/v1/auth/totp.
//
// Auth: Bearer access token.
// Requires the user's current master password for confirmation.
// On success: deletes totp_secrets + recovery_codes rows for the calling
// user, and sets users.status back to 'active' (it was already 'active'
// with TOTP; disabling doesn't change it, but it ensures consistency).
func (s *AuthHandlers) TOTPDisable(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	var req totpDisableRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.MasterPassword == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"master_password zorunlu.", errors.New("missing master_password"))
		return
	}

	ctx := r.Context()

	// Verify current password before destructive TOTP removal.
	currentHash, currentParams, err := fetchUserCredsByID(ctx, s.Service.DB, claims.Subject)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı sorgulanamadı.", err)
		return
	}

	salt, err := extractSaltFromParams(currentParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre parametreleri okunamadı.", err)
		return
	}

	pwOK, err := auth.VerifyPassword(req.MasterPassword, currentHash, salt, currentParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre doğrulanamadı.", err)
		return
	}
	if !pwOK {
		_ = recordLoginFailure(ctx, s.Service.DB, claims.Subject)
		writeInvalidCreds(w, s.Logger, errors.New("password mismatch on totp disable"))
		return
	}

	// Check TOTP is actually enabled — graceful 409 if not.
	var enabled bool
	if err := s.Service.DB.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM totp_secrets WHERE user_id = $1::uuid AND verified = true)`,
		claims.Subject,
	).Scan(&enabled); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP durumu okunamadı.", err)
		return
	}
	if !enabled {
		writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
			"TOTP bu hesapta zaten devre dışı.", errors.New("totp not enabled"))
		return
	}

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`DELETE FROM totp_secrets WHERE user_id = $1::uuid`,
		claims.Subject,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret silinemedi.", err)
		return
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM recovery_codes WHERE user_id = $1::uuid`,
		claims.Subject,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code'lar silinemedi.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthTOTPDisabled,
		ResourceType: audit.ResourceUser,
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// totpRegenerateBackupRequest is the body of POST /api/v1/auth/totp/backup-codes/regenerate.
type totpRegenerateBackupRequest struct {
	// TOTPCode is the current 6-digit authenticator code — confirms the user
	// still has their TOTP device before handing out a fresh set of codes.
	TOTPCode string `json:"totp_code"`
}

// TOTPRegenerateBackup implements POST /api/v1/auth/totp/backup-codes/regenerate.
//
// Auth: Bearer access token.
// Requires a valid current TOTP code to confirm device possession.
// Replaces all existing recovery codes with 10 freshly-generated ones and
// returns the plaintext codes ONCE (not stored in plaintext).
func (s *AuthHandlers) TOTPRegenerateBackup(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	var req totpRegenerateBackupRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if len(req.TOTPCode) < 6 || len(req.TOTPCode) > 8 {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeInvalidCode,
			"TOTP kodu 6 haneli olmalı.", errors.New("bad code length"))
		return
	}

	ctx := r.Context()

	// Fetch encrypted TOTP secret — also serves as "TOTP is enabled" check.
	const fetchSQL = `
		SELECT secret_enc
		FROM totp_secrets
		WHERE user_id = $1::uuid AND verified = true
		LIMIT 1
	`
	var enc []byte
	if err := s.Service.DB.QueryRow(ctx, fetchSQL, claims.Subject).Scan(&enc); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
				"TOTP bu hesapta etkin değil.", err)
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret okunamadı.", err)
		return
	}

	aad := crypto.MakeAAD("totp_secrets", claims.Subject, "secret_enc")
	secret, err := s.Service.Master.Open(enc, aad)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret çözülemedi.", err)
		return
	}

	if err := auth.VerifyTOTP(secret, req.TOTPCode); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeInvalidCode,
			"TOTP kodu geçersiz.", err)
		return
	}

	// Generate new codes before touching the DB so a generation failure is clean.
	plain, hashes, err := auth.GenerateRecoveryCodes(10)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code üretilemedi.", err)
		return
	}

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Delete all existing codes first.
	if _, err := tx.Exec(ctx,
		`DELETE FROM recovery_codes WHERE user_id = $1::uuid`,
		claims.Subject,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Eski recovery code'lar silinemedi.", err)
		return
	}

	// Insert new codes.
	for _, h := range hashes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1::uuid, $2)`,
			claims.Subject, h,
		); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yeni recovery code kaydedilemedi.", err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthTOTPBackupRegenerated,
		ResourceType: audit.ResourceUser,
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, totpVerifyResponse{RecoveryCodes: plain})
}
