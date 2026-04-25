package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

type totpInitResponse struct {
	OtpAuthURL   string `json:"otpauth_uri"`
	Base32Secret string `json:"secret_base32"`
}

// TOTPInit implements POST /api/v1/auth/totp/init.
// Auth: tmp_token (purpose=totp_enroll). Generates fresh secret, envelope
// encrypts, persists to totp_secrets (verified=false). Idempotent — calling
// again before /verify replaces the old secret.
func (s *AuthHandlers) TOTPInit(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireTmpToken(w, r, auth.PurposeTOTPEnroll)
	if !ok {
		return
	}

	// Look up username for the otpauth label.
	username, err := s.fetchUsername(r.Context(), userID)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı bulunamadı.", err)
		return
	}

	enroll, err := auth.GenerateTOTP(s.Service.IssuerName, username)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP üretilemedi.", err)
		return
	}

	// Envelope-encrypt the raw secret with the master cipher.
	aad := crypto.MakeAAD("totp_secrets", userID, "secret_enc")
	enc, err := s.Service.Master.Seal(enroll.Secret, aad)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP şifrelenemedi.", err)
		return
	}
	// Pull the nonce out of the blob for storage in totp_secrets.nonce
	// (the schema stores nonce separately for index/audit purposes; the
	// blob still contains the same nonce, but persisting it directly avoids
	// re-parsing on read).
	nonce := extractNonce(enc, crypto.AESGCMNonceLen)

	const upsertSQL = `
		INSERT INTO totp_secrets (user_id, secret_enc, nonce, master_key_id, verified)
		VALUES ($1::uuid, $2, $3, $4, false)
		ON CONFLICT (user_id) DO UPDATE SET
			secret_enc = EXCLUDED.secret_enc,
			nonce = EXCLUDED.nonce,
			master_key_id = EXCLUDED.master_key_id,
			verified = false,
			created_at = now(),
			verified_at = NULL
	`
	if _, err := s.Service.DB.Exec(r.Context(), upsertSQL,
		userID, enc, nonce, s.Service.MasterKey.ID,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret'ı kaydedilemedi.", err)
		return
	}

	_ = s.Audit.Write(r.Context(), audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthTOTPInit,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, totpInitResponse{
		OtpAuthURL:   enroll.OtpAuthURL,
		Base32Secret: enroll.Base32,
	})
}

type totpVerifyRequest struct {
	Code string `json:"code"`
}

type totpVerifyResponse struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

// TOTPVerify implements POST /api/v1/auth/totp/verify.
// On success: marks totp_secret verified, flips users.status to 'active',
// generates 10 recovery codes (Argon2id-hashed), returns plaintext codes ONCE.
func (s *AuthHandlers) TOTPVerify(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireTmpToken(w, r, auth.PurposeTOTPEnroll)
	if !ok {
		return
	}

	var req totpVerifyRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if len(req.Code) < 6 || len(req.Code) > 8 {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeInvalidCode,
			"TOTP kodu 6 haneli olmalı.", errors.New("bad code length"))
		return
	}

	// Fetch encrypted secret.
	const fetchSQL = `
		SELECT secret_enc
		FROM totp_secrets
		WHERE user_id = $1::uuid
		LIMIT 1
	`
	var enc []byte
	if err := s.Service.DB.QueryRow(r.Context(), fetchSQL, userID).Scan(&enc); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"TOTP henüz başlatılmadı (önce /totp/init çağırın).", err)
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret okunamadı.", err)
		return
	}

	aad := crypto.MakeAAD("totp_secrets", userID, "secret_enc")
	secret, err := s.Service.Master.Open(enc, aad)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret çözülemedi.", err)
		return
	}

	if err := auth.VerifyTOTP(secret, req.Code); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeInvalidCode,
			"TOTP kodu geçersiz.", err)
		return
	}

	// Generate 10 recovery codes BEFORE the tx so failure here doesn't half-
	// commit. ADR-0004 §9: each code 16 hex chars, Argon2id-hashed.
	plain, hashes, err := auth.GenerateRecoveryCodes(10)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code üretilemedi.", err)
		return
	}

	tx, err := s.Service.DB.Begin(r.Context())
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	if _, err := tx.Exec(r.Context(),
		`UPDATE totp_secrets SET verified = true, verified_at = now() WHERE user_id = $1::uuid`,
		userID,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP doğrulaması kaydedilemedi.", err)
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE users SET status = 'active' WHERE id = $1::uuid`,
		userID,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı statüsü güncellenemedi.", err)
		return
	}
	for _, h := range hashes {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1::uuid, $2)`,
			userID, h,
		); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Recovery code kaydedilemedi.", err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = s.Audit.Write(r.Context(), audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthTOTPVerified,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, totpVerifyResponse{RecoveryCodes: plain})
}

// requireTmpToken extracts and validates the bearer tmp token, returning the
// user id (subject) on success. On failure it writes an error and returns
// ok=false.
func (s *AuthHandlers) requireTmpToken(w http.ResponseWriter, r *http.Request, expected string) (string, bool) {
	authz := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(authz) <= len(prefix) || authz[:len(prefix)] != prefix {
		writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Authorization header eksik.", errors.New("no bearer"))
		return "", false
	}
	token := authz[len(prefix):]
	claims, err := s.Service.JWT.Parse(token, expected)
	if err != nil {
		writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeInvalidToken,
			"Token geçersiz.", err)
		return "", false
	}
	return claims.Subject, true
}

// fetchUsername returns the user's username (used for TOTP otpauth label).
func (s *AuthHandlers) fetchUsername(ctx context.Context, userID string) (string, error) {
	var u string
	err := s.Service.DB.QueryRow(ctx,
		`SELECT username FROM users WHERE id = $1::uuid LIMIT 1`,
		userID,
	).Scan(&u)
	return u, err
}

// extractNonce returns the nonce slice from a versioned blob.
func extractNonce(blob []byte, nonceLen int) []byte {
	if len(blob) < crypto.HeaderLen+nonceLen {
		return nil
	}
	out := make([]byte, nonceLen)
	copy(out, blob[crypto.HeaderLen:crypto.HeaderLen+nonceLen])
	return out
}
