package httpapi

import (
	"context"
	"errors"
	"net/http"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// changePasswordRequest is the body of POST /api/v1/auth/change-password.
//
// Design (PR-7 §1, see PROGRESS): public_key STAYS THE SAME. Only the
// private_key wrapping changes — client decrypts priv with old KEK, re-wraps
// with new KEK derived from new master password. This preserves item_shares
// accessibility (the wrapped DEK copies are bound to the unchanged pub key).
//
// The handler enforces shape, but does NOT verify that public_key actually
// equals the stored one — clients that lie hose only their own access. The
// db-level CHECK on octet_length keeps it shape-correct.
type changePasswordRequest struct {
	CurrentPassword  string         `json:"current_master_password"`
	NewPassword      string         `json:"new_master_password"`
	NewPrivateKeyEnc []byte         `json:"new_private_key_enc"` // base64
	NewKEKSalt       []byte         `json:"new_kek_salt"`        // base64
	NewKEKParams     map[string]any `json:"new_kek_params"`
}

// ChangePassword implements POST /api/v1/auth/change-password.
//
// Auth: Bearer access token.
//
// Steps:
//  1. Verify current password (Argon2id). Wrong → recordLoginFailure (shared
//     counter with login) + 401 invalid_credentials.
//  2. Hash new password with fresh server-side salt.
//  3. Single tx:
//     - UPDATE users.password_hash + argon2_params
//     - UPDATE user_keypairs.private_key_enc + kek_salt + kek_params
//     (public_key is left untouched, so item_shares stay accessible)
//     - RevokeAllUserSessions(user, 'admin') — every device must re-login
//     with the new password
//  4. Audit auth.password_changed.
//  5. 204 No Content.
func (s *AuthHandlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	var req changePasswordRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if err := validateChangePassword(req); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Pull current hash + params for verification (lookup by user_id from JWT).
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
	pwOK, err := auth.VerifyPassword(req.CurrentPassword, currentHash, salt, currentParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre doğrulanamadı.", err)
		return
	}
	if !pwOK {
		_ = recordLoginFailure(ctx, s.Service.DB, claims.Subject)
		writeInvalidCreds(w, s.Logger, errors.New("current password mismatch"))
		return
	}

	hp, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Yeni şifre işlenirken hata oluştu.", err)
		return
	}

	kekParamsJSON, err := marshalJSON(req.NewKEKParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"new_kek_params geçersiz.", err)
		return
	}

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const updateUserSQL = `
		UPDATE users
		SET password_hash = $2,
		    argon2_params = $3,
		    failed_login_attempts = 0,
		    locked_until = NULL,
		    must_change_password = false
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateUserSQL, claims.Subject, hp.Hash, hp.ParamsJSON); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre güncellenemedi.", err)
		return
	}
	// Persist the new salt inside argon2_params jsonb (same layout as register).
	if err := persistArgon2Salt(ctx, tx, claims.Subject, hp); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre parametreleri yazılamadı.", err)
		return
	}

	// Re-wrap priv key (public_key stays the same → item_shares preserved).
	const updateKeypairSQL = `
		UPDATE user_keypairs
		SET private_key_enc = $2,
		    kek_salt = $3,
		    kek_params = $4,
		    rotated_at = now(),
		    version = version + 1
		WHERE user_id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateKeypairSQL,
		claims.Subject, req.NewPrivateKeyEnc, req.NewKEKSalt, kekParamsJSON,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti güncellenemedi.", err)
		return
	}

	// Force every device to re-login with the new password.
	if err := auth.RevokeAllUserSessions(ctx, tx, claims.Subject, auth.RevokeReasonAdmin); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturumlar revoke edilemedi.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthPwdChanged,
		ResourceType: audit.ResourceUser,
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

func validateChangePassword(req changePasswordRequest) error {
	if req.CurrentPassword == "" {
		return errors.New("current_master_password zorunlu")
	}
	if len(req.NewPassword) < 12 {
		return errors.New("new_master_password en az 12 karakter olmalı")
	}
	if len(req.NewPrivateKeyEnc) == 0 {
		return errors.New("new_private_key_enc zorunlu")
	}
	if len(req.NewKEKSalt) < 16 {
		return errors.New("new_kek_salt en az 16 byte olmalı")
	}
	if len(req.NewKEKParams) == 0 {
		return errors.New("new_kek_params zorunlu")
	}
	return nil
}

// fetchUserCredsByID returns just password_hash + argon2_params for the
// claims-identified user (lookup by id, used by /change-password and
// recovery flows).
func fetchUserCredsByID(ctx context.Context, db auth.DBExec, userID string) ([]byte, []byte, error) {
	const sqlText = `
		SELECT password_hash, argon2_params
		FROM users
		WHERE id = $1::uuid
		LIMIT 1
	`
	var hash, params []byte
	err := db.QueryRow(ctx, sqlText, userID).Scan(&hash, &params)
	return hash, params, err
}
