package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
	"envanter.app/server/internal/ws"
)

// shareItemRequest is the body of POST /api/v1/items/{id}/shares.
//
// dek_wrapped is produced client-side: the owner takes their per-item DEK
// (kept in their RAM after decrypting their own item_share row) and wraps
// it with the recipient's X25519 public_key (sealed-box). Server stores
// the opaque blob; never sees the DEK.
type shareItemRequest struct {
	UserID     string `json:"user_id"`
	Permission string `json:"permission"` // 'read' | 'write'
	DEKWrapped []byte `json:"dek_wrapped"`
	WrapNonce  []byte `json:"wrap_nonce"` // 12B
}

// Share implements POST /api/v1/items/{id}/shares.
//
// Caller needs Write on the item (or admin). UPSERT semantics: re-sharing
// updates the wrap (e.g. after recipient rotated keypair) and re-grants
// (revoked_at=NULL). Self-share blocked; owner already has the implicit
// owner share row (created by /items POST).
func (h *ItemHandlers) Share(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item id zorunlu.", errors.New("missing id"))
		return
	}

	var req shareItemRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"user_id zorunlu.", errors.New("missing user_id"))
		return
	}
	if req.Permission != string(auth.ItemPermRead) && req.Permission != string(auth.ItemPermWrite) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"permission 'read' veya 'write' olmalı.", errors.New("bad permission"))
		return
	}
	if len(req.DEKWrapped) == 0 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"dek_wrapped zorunlu.", errors.New("missing dek_wrapped"))
		return
	}
	if len(req.WrapNonce) != crypto.AESGCMNonceLen {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"wrap_nonce 12 byte olmalı.", errors.New("bad nonce length"))
		return
	}
	if req.UserID == claims.Subject {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Owner zaten erişebilir; kendinize paylaşamazsınız.",
			errors.New("self-share"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item'ı paylaşmak için yazma yetkisi gerekli.",
				errors.New("write denied"))
			return
		}
	}

	const upsertSQL = `
		INSERT INTO item_shares
		    (item_id, user_id, e2e_dek_wrapped, wrap_nonce, permission, granted_by, revoked_at)
		VALUES
		    ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, NULL)
		ON CONFLICT (item_id, user_id) DO UPDATE SET
		    e2e_dek_wrapped = EXCLUDED.e2e_dek_wrapped,
		    wrap_nonce      = EXCLUDED.wrap_nonce,
		    permission      = EXCLUDED.permission,
		    granted_by      = EXCLUDED.granted_by,
		    granted_at      = now(),
		    revoked_at      = NULL
	`
	if _, err := h.Service.DB.Exec(ctx, upsertSQL,
		itemID, req.UserID, req.DEKWrapped, req.WrapNonce,
		req.Permission, claims.Subject,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Paylaşım kaydedilemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemShared,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details: map[string]any{
			"target_user_id": req.UserID,
			"permission":     req.Permission,
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})
	h.publishEvent(ws.EventItemShared, itemID, claims.Subject)

	w.WriteHeader(http.StatusNoContent)
}

// Unshare implements DELETE /api/v1/items/{id}/shares/{user_id}.
//
// Soft revoke (revoked_at=now). Idempotent. Owner row should not be
// revoked through this — guard added below.
func (h *ItemHandlers) Unshare(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	targetUserID := chi.URLParam(r, "user_id")
	if itemID == "" || targetUserID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve user_id zorunlu.", errors.New("missing path params"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Yazma yetkisi yok.", errors.New("write denied"))
			return
		}
	}

	// Don't let anyone revoke the owner's own share — that would orphan
	// the item from its creator. Owner share = items.created_by row.
	var createdBy string
	err := h.Service.DB.QueryRow(ctx,
		`SELECT created_by::text FROM items WHERE id = $1::uuid LIMIT 1`,
		itemID,
	).Scan(&createdBy)
	if err == nil && createdBy == targetUserID {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Owner share kaldırılamaz.", errors.New("can't revoke owner share"))
		return
	}

	const revokeSQL = `
		UPDATE item_shares
		SET revoked_at = now()
		WHERE item_id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL
	`
	tag, err := h.Service.DB.Exec(ctx, revokeSQL, itemID, targetUserID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Paylaşım kaldırılamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Already revoked / never existed — idempotent 204.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemUnshared,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"target_user_id": targetUserID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	h.publishEvent(ws.EventItemUnshared, itemID, claims.Subject)

	w.WriteHeader(http.StatusNoContent)
}
