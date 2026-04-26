package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// recoverInitRequest is the body of POST /api/v1/auth/recover/init.
type recoverInitRequest struct {
	Username     string `json:"username"`
	RecoveryCode string `json:"recovery_code"`
}

type recoverInitResponse struct {
	TmpToken string `json:"tmp_token"`
}

// RecoverInit implements POST /api/v1/auth/recover/init.
//
// Steps:
//  1. Lookup user, gate on lockout (shared counter with login per ADR-0004
//     §10 — no separate failed_recovery_attempts column).
//  2. Fetch unused recovery_codes for that user, Argon2id-verify each.
//  3. Match → mark code used (used_at + used_ip), revoke all sessions
//     ('recovery'), issue tmp_token (purpose=recovery, 15m), audit
//     auth.recover.
//  4. No match → recordLoginFailure (counter shared), audit
//     auth.recover_fail, 401 invalid_credentials.
//
// Generic 401 envelope: do not leak whether the username exists.
func (s *AuthHandlers) RecoverInit(w http.ResponseWriter, r *http.Request) {
	var req recoverInitRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.Username == "" || req.RecoveryCode == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"username ve recovery_code zorunlu.", errors.New("missing field"))
		return
	}

	ctx := r.Context()
	userRow, err := fetchUserForLogin(ctx, s.Service.DB, strings.ToLower(req.Username))
	if err != nil {
		// Generic 401 regardless. Do NOT distinguish "user not found" from
		// "wrong code" — that would let an attacker enumerate usernames.
		s.recordRecoverFail(ctx, r, "", "user_not_found")
		writeInvalidCreds(w, s.Logger, errors.New("recover: lookup failed"))
		return
	}
	if auth.IsLocked(userRow.LockedUntil) {
		s.recordRecoverFail(ctx, r, userRow.ID, "locked")
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap geçici olarak kilitli.", errors.New("locked"))
		return
	}

	// Fetch all unused recovery hashes for the user. The list is small (<=10),
	// linear scan + per-row Argon2 verify is acceptable.
	hashes, ids, err := fetchUnusedRecoveryCodes(ctx, s.Service.DB, userRow.ID)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code'lar okunamadı.", err)
		return
	}

	matchedID := ""
	for i, h := range hashes {
		if auth.VerifyRecoveryCode(req.RecoveryCode, h) {
			matchedID = ids[i]
			break
		}
	}
	if matchedID == "" {
		_ = recordLoginFailure(ctx, s.Service.DB, userRow.ID)
		s.recordRecoverFail(ctx, r, userRow.ID, "wrong_code")
		writeInvalidCreds(w, s.Logger, errors.New("recovery code mismatch"))
		return
	}

	// Single tx: mark code used + revoke all sessions. The tmp_token issued
	// after commit lets the client move to /recover/complete.
	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const markUsedSQL = `
		UPDATE recovery_codes
		SET used_at = now(), used_ip = $2
		WHERE id = $1::uuid AND used_at IS NULL
	`
	if _, err := tx.Exec(ctx, markUsedSQL, matchedID, parseIP(r.RemoteAddr).String()); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code işaretlenemedi.", err)
		return
	}
	if err := auth.RevokeAllUserSessions(ctx, tx, userRow.ID, auth.RevokeReasonRecovery); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturumlar revoke edilemedi.", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	tmp, err := s.Service.JWT.IssueTmp(userRow.ID, auth.PurposeRecovery)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Geçici token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userRow.ID,
		Action:       audit.ActionAuthRecover,
		ResourceType: audit.ResourceUser,
		ResourceID:   userRow.ID,
		Details:      map[string]any{"step": "init"},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, recoverInitResponse{TmpToken: tmp})
}

// recoverCompleteRequest is the body of POST /api/v1/auth/recover/complete.
//
// Recovery deliberately rotates the keypair (the user's old master password
// is gone so the old priv key is unrecoverable). This invalidates every
// item_share row that was wrapped with the old pub key — those items become
// inaccessible. The client UI MUST warn loudly before invoking this
// endpoint (ADR-0004 §9).
type recoverCompleteRequest struct {
	NewPassword      string         `json:"new_master_password"`
	PublicKey        []byte         `json:"public_key"` // base64, 32B
	NewPrivateKeyEnc []byte         `json:"new_private_key_enc"`
	NewKEKSalt       []byte         `json:"new_kek_salt"`
	NewKEKParams     map[string]any `json:"new_kek_params"`
}

type recoverCompleteResponse struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

// RecoverComplete implements POST /api/v1/auth/recover/complete.
//
// Auth: Bearer tmp_token (purpose=recovery), issued by /recover/init.
//
// Single tx:
//   - UPDATE users.password_hash + argon2_params
//   - UPDATE user_keypairs.public_key + private_key_enc + kek_* (full rotate;
//     version++, rotated_at=now)
//   - DELETE all recovery_codes for the user (old codes are dead, freshly
//     generated 10 replace them)
//   - INSERT 10 new recovery_codes
//   - RevokeAllUserSessions('recovery') — defensive (init already did this,
//     but a paranoid double-check is cheap)
//
// Returns the 10 new recovery codes (plaintext) ONCE.
func (s *AuthHandlers) RecoverComplete(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireTmpToken(w, r, auth.PurposeRecovery)
	if !ok {
		return
	}

	var req recoverCompleteRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if err := validateRecoverComplete(req); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

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

	// Generate 10 fresh recovery codes BEFORE the tx so a hash failure here
	// doesn't leave a half-rotated user.
	plain, codeHashes, err := auth.GenerateRecoveryCodes(10)
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

	const updateUserSQL = `
		UPDATE users
		SET password_hash = $2,
		    argon2_params = $3,
		    failed_login_attempts = 0,
		    locked_until = NULL,
		    status = 'active'
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateUserSQL, userID, hp.Hash, hp.ParamsJSON); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı güncellenemedi.", err)
		return
	}
	if err := persistArgon2Salt(ctx, tx, userID, hp); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre parametreleri yazılamadı.", err)
		return
	}

	const rotateKeypairSQL = `
		UPDATE user_keypairs
		SET public_key = $2,
		    private_key_enc = $3,
		    kek_salt = $4,
		    kek_params = $5,
		    rotated_at = now(),
		    version = version + 1
		WHERE user_id = $1::uuid
	`
	if _, err := tx.Exec(ctx, rotateKeypairSQL,
		userID, req.PublicKey, req.NewPrivateKeyEnc, req.NewKEKSalt, kekParamsJSON,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti güncellenemedi.", err)
		return
	}

	// Drop every leftover recovery row, used or unused, then insert the
	// freshly generated 10. ADR-0004 §9: recovery is "all or nothing"
	// — any unused old code stays valid otherwise.
	if _, err := tx.Exec(ctx,
		`DELETE FROM recovery_codes WHERE user_id = $1::uuid`, userID,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Eski recovery code'lar silinemedi.", err)
		return
	}
	for _, h := range codeHashes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1::uuid, $2)`,
			userID, h,
		); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yeni recovery code kaydedilemedi.", err)
			return
		}
	}

	// Defensive double-revoke. /init already revoked everything, but the
	// extra UPDATE on an empty active set is a no-op cheap safety net.
	if err := auth.RevokeAllUserSessions(ctx, tx, userID, auth.RevokeReasonRecovery); err != nil {
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
		ActorUserID:  userID,
		Action:       audit.ActionAuthRecover,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"step": "complete"},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthPwdChanged,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"via": "recovery"},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, recoverCompleteResponse{RecoveryCodes: plain})
}

func validateRecoverComplete(req recoverCompleteRequest) error {
	if len(req.NewPassword) < 12 {
		return errors.New("new_master_password en az 12 karakter olmalı")
	}
	if len(req.PublicKey) != 32 {
		return errors.New("public_key 32 byte olmalı (X25519)")
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

// fetchUnusedRecoveryCodes returns the (code_hash, id) lists for unused codes
// belonging to the user. Done with a SQL array_agg to keep us inside the
// auth.DBExec interface (no Query method).
func fetchUnusedRecoveryCodes(ctx context.Context, db auth.DBExec, userID string) (hashes [][]byte, ids []string, err error) {
	const sqlText = `
		SELECT
		    COALESCE(array_agg(id::text  ORDER BY created_at), '{}'),
		    COALESCE(array_agg(code_hash ORDER BY created_at), '{}')
		FROM recovery_codes
		WHERE user_id = $1::uuid AND used_at IS NULL
	`
	err = db.QueryRow(ctx, sqlText, userID).Scan(&ids, &hashes)
	return hashes, ids, err
}

// recordRecoverFail emits an auth.recover_fail audit row. ActorUserID is
// empty if the username didn't exist (avoid leaking via audit details).
func (s *AuthHandlers) recordRecoverFail(ctx context.Context, r *http.Request, userID, reason string) {
	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthRecoverFail,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"reason": reason},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
}
