package httpapi

// api_tokens.go — PR-ANSIBLE: API token management (read/ansible/scim scopes).
//
// GET    /api/v1/users/me/api-tokens       — list my tokens (no plaintext)
// POST   /api/v1/users/me/api-tokens       — create token (returns plaintext once)
// DELETE /api/v1/users/me/api-tokens/{id}  — revoke token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"

	"envanter.app/server/internal/audit"
	"github.com/go-chi/chi/v5"
)

// APITokenHandlers groups API token management endpoints.
type APITokenHandlers struct {
	ItemH *ItemHandlers // re-uses DB, auth service, logger, audit
}

type apiTokenResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Scope       string  `json:"scope"`
	ExpiresAt   *string `json:"expires_at,omitempty"`
	LastUsedAt  *string `json:"last_used_at,omitempty"`
	CreatedAt   string  `json:"created_at"`
	// PlainToken is only non-empty on initial creation response.
	PlainToken  string  `json:"token,omitempty"`
}

// ListAPITokens implements GET /api/v1/users/me/api-tokens.
func (h *APITokenHandlers) ListAPITokens(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	rows, err := h.ItemH.Service.DB.Query(r.Context(), `
		SELECT id::text, name, scope, expires_at::text, last_used_at::text, created_at::text
		FROM api_tokens WHERE user_id = $1::uuid ORDER BY created_at DESC
	`, claims.Subject)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Token listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]apiTokenResponse, 0)
	for rows.Next() {
		var t apiTokenResponse
		var expiresAt, lastUsedAt *string
		if err := rows.Scan(&t.ID, &t.Name, &t.Scope, &expiresAt, &lastUsedAt, &t.CreatedAt); err != nil {
			continue
		}
		t.ExpiresAt = expiresAt
		t.LastUsedAt = lastUsedAt
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

// CreateAPIToken implements POST /api/v1/users/me/api-tokens.
func (h *APITokenHandlers) CreateAPIToken(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req struct {
		Name      string  `json:"name"`
		Scope     string  `json:"scope"`
		ExpiresAt *string `json:"expires_at,omitempty"`
	}
	if !decodeJSON(w, r, h.ItemH.Logger, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, h.ItemH.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name zorunlu.", nil)
		return
	}
	if req.Scope == "" {
		req.Scope = "read"
	}
	validScopes := map[string]bool{"read": true, "ansible": true, "scim": true}
	if !validScopes[req.Scope] {
		writeError(w, h.ItemH.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"scope geçersiz (read|ansible|scim).", nil)
		return
	}

	// Generate a 32-byte random token, encode as hex (64 chars).
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Token üretilemedi.", err)
		return
	}
	plain := hex.EncodeToString(raw[:])
	hash := sha256.Sum256([]byte(plain))

	var id, createdAt string
	err := h.ItemH.Service.DB.QueryRow(r.Context(), `
		INSERT INTO api_tokens (user_id, name, token_hash, scope, expires_at)
		VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
		RETURNING id::text, created_at::text
	`, claims.Subject, req.Name, hash[:], req.Scope, req.ExpiresAt).Scan(&id, &createdAt)
	if err != nil {
		writeError(w, h.ItemH.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Token kaydedilemedi.", err)
		return
	}

	_ = h.ItemH.Audit.Write(r.Context(), audit.Entry{
		Action:      "api_token.created",
		ActorUserID: claims.Subject,
		ResourceType: "api_token",
		ResourceID:  id,
		Details:     map[string]any{"scope": req.Scope, "name": req.Name},
	})

	writeJSON(w, http.StatusCreated, apiTokenResponse{
		ID:         id,
		Name:       req.Name,
		Scope:      req.Scope,
		ExpiresAt:  req.ExpiresAt,
		CreatedAt:  createdAt,
		PlainToken: plain, // shown once — not stored in plaintext
	})
}

// DeleteAPIToken implements DELETE /api/v1/users/me/api-tokens/{id}.
func (h *APITokenHandlers) DeleteAPIToken(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.ItemH.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	tokenID := chi.URLParam(r, "id")
	tag, err := h.ItemH.Service.DB.Exec(r.Context(), `
		DELETE FROM api_tokens WHERE id = $1::uuid AND user_id = $2::uuid
	`, tokenID, claims.Subject)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.ItemH.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Token bulunamadı.", err)
		return
	}

	_ = h.ItemH.Audit.Write(r.Context(), audit.Entry{
		Action:      "api_token.revoked",
		ActorUserID: claims.Subject,
		ResourceType: "api_token",
		ResourceID:  tokenID,
	})

	w.WriteHeader(http.StatusNoContent)
}
