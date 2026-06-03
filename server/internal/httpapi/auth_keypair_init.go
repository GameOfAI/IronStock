package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// keypairInitRequest is the body of POST /api/v1/auth/keypair-init.
//
// Sent by the Tauri client (or any client) when it detects a placeholder
// keypair (kek_params.alg == "none") after login. The client generates a
// proper X25519 keypair, derives a KEK from the user's master password, and
// ships the encrypted private key here. The server replaces the placeholder
// without touching the password or revoking sessions.
type keypairInitRequest struct {
	CurrentPassword  string         `json:"current_master_password"`
	NewPublicKey     []byte         `json:"new_public_key"`      // 32-byte X25519 pub, base64
	NewPrivateKeyEnc []byte         `json:"new_private_key_enc"` // encrypted private key, base64
	NewKEKSalt       []byte         `json:"new_kek_salt"`        // base64
	NewKEKParams     map[string]any `json:"new_kek_params"`
}

// InitKeypair implements POST /api/v1/auth/keypair-init.
//
// Auth: Bearer access token.
//
// Only proceeds if the current keypair is a placeholder (kek_params contains
// "alg":"none"). This prevents misuse as an unauthenticated key-rotation
// endpoint. If the keypair is already proper, returns 409 Conflict.
//
// Steps:
//  1. Verify current password (Argon2id).
//  2. Read current kek_params — reject if not placeholder.
//  3. UPDATE user_keypairs with the new proper keypair.
//  4. Audit auth.keypair_initialized.
//  5. 204 No Content.
func (s *AuthHandlers) InitKeypair(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	var req keypairInitRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if err := validateKeypairInit(req); err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Verify current password.
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

	// Fetch current kek_params — only allow init if it's a placeholder.
	var rawKEKParams []byte
	err = s.Service.DB.QueryRow(ctx,
		`SELECT kek_params FROM user_keypairs WHERE user_id = $1::uuid LIMIT 1`,
		claims.Subject,
	).Scan(&rawKEKParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Keypair sorgulanamadı.", err)
		return
	}

	var existing struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(rawKEKParams, &existing); err != nil || existing.Alg != "none" {
		writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
			"Keypair zaten başlatılmış. Değiştirmek için /auth/change-password kullanın.", nil)
		return
	}

	kekParamsJSON, err := marshalJSON(req.NewKEKParams)
	if err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"new_kek_params geçersiz.", err)
		return
	}

	// Replace placeholder with proper keypair (no session revocation — password unchanged).
	const sql = `
		UPDATE user_keypairs
		SET public_key      = $2,
		    private_key_enc = $3,
		    kek_salt        = $4,
		    kek_params      = $5,
		    rotated_at      = now(),
		    version         = version + 1
		WHERE user_id = $1::uuid
	`
	if _, err := s.Service.DB.Exec(ctx, sql,
		claims.Subject, req.NewPublicKey, req.NewPrivateKeyEnc, req.NewKEKSalt, kekParamsJSON,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Keypair başlatılamadı.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthKeypairInitialized,
		ResourceType: audit.ResourceUser,
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

func validateKeypairInit(req keypairInitRequest) error {
	if req.CurrentPassword == "" {
		return errors.New("current_master_password zorunlu")
	}
	if len(req.NewPublicKey) != 32 {
		return errors.New("new_public_key 32 byte olmalı")
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
