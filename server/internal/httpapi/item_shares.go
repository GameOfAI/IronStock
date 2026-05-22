package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
	"envanter.app/server/internal/ws"
)

// ---- List shares --------------------------------------------------------

// itemShareEntry is a per-user share record returned by ListShares.
type itemShareEntry struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Username   string     `json:"username"`
	Permission string     `json:"permission"`
	GrantedBy  string     `json:"granted_by"`
	GrantedAt  time.Time  `json:"granted_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	ValidFrom  *time.Time `json:"valid_from,omitempty"`
	ValidUntil *time.Time `json:"valid_until,omitempty"`
}

// itemGroupShareEntry is a per-group share record returned by ListShares.
type itemGroupShareEntry struct {
	ID         string     `json:"id"`
	GroupID    string     `json:"group_id"`
	GroupName  string     `json:"group_name"`
	Permission string     `json:"permission"`
	GrantedBy  string     `json:"granted_by"`
	GrantedAt  time.Time  `json:"granted_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	ValidFrom  *time.Time `json:"valid_from,omitempty"`
	ValidUntil *time.Time `json:"valid_until,omitempty"`
}

type itemSharesListResponse struct {
	Users  []itemShareEntry      `json:"users"`
	Groups []itemGroupShareEntry `json:"groups"`
}

// ListShares implements GET /api/v1/items/{id}/shares.
// Returns active user shares and group shares for the item.
// Requires Write permission on the item (or admin).
func (h *ItemHandlers) ListShares(w http.ResponseWriter, r *http.Request) {
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
				"Paylaşım listesi için yazma yetkisi gerekli.", errors.New("write denied"))
			return
		}
	}

	// User shares
	const userSharesSQL = `
		SELECT s.id::text, s.user_id::text, u.username, s.permission,
		       s.granted_by::text, s.granted_at, s.revoked_at, s.valid_from, s.valid_until
		FROM item_shares s
		JOIN users u ON u.id = s.user_id
		WHERE s.item_id = $1::uuid
		ORDER BY s.granted_at DESC
	`
	rows, err := h.Service.DB.Query(ctx, userSharesSQL, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Paylaşım listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	userShares := make([]itemShareEntry, 0)
	for rows.Next() {
		var e itemShareEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Permission,
			&e.GrantedBy, &e.GrantedAt, &e.RevokedAt, &e.ValidFrom, &e.ValidUntil); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Paylaşım satırı okunamadı.", err)
			return
		}
		userShares = append(userShares, e)
	}

	// Group shares
	const groupSharesSQL = `
		SELECT gs.id::text, gs.group_id::text, g.name, gs.permission,
		       gs.granted_by::text, gs.granted_at, gs.revoked_at, gs.valid_from, gs.valid_until
		FROM item_group_shares gs
		JOIN groups g ON g.id = gs.group_id
		WHERE gs.item_id = $1::uuid
		ORDER BY gs.granted_at DESC
	`
	grows, err := h.Service.DB.Query(ctx, groupSharesSQL, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup paylaşım listesi alınamadı.", err)
		return
	}
	defer grows.Close()

	groupShares := make([]itemGroupShareEntry, 0)
	for grows.Next() {
		var e itemGroupShareEntry
		if err := grows.Scan(&e.ID, &e.GroupID, &e.GroupName, &e.Permission,
			&e.GrantedBy, &e.GrantedAt, &e.RevokedAt, &e.ValidFrom, &e.ValidUntil); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Grup paylaşım satırı okunamadı.", err)
			return
		}
		groupShares = append(groupShares, e)
	}

	writeJSON(w, http.StatusOK, itemSharesListResponse{
		Users:  userShares,
		Groups: groupShares,
	})
}

// shareItemRequest is the body of POST /api/v1/items/{id}/shares.
//
// dek_wrapped is produced client-side: the owner takes their per-item DEK
// (kept in their RAM after decrypting their own item_share row) and wraps
// it with the recipient's X25519 public_key (sealed-box). Server stores
// the opaque blob; never sees the DEK.
//
// valid_from / valid_until are optional time-window fields (PR-TIME).
// NULL = no bound (immediate / permanent).
type shareItemRequest struct {
	UserID     string     `json:"user_id"`
	Permission string     `json:"permission"` // 'read' | 'write'
	DEKWrapped []byte     `json:"dek_wrapped"`
	WrapNonce  []byte     `json:"wrap_nonce"` // 12B
	ValidFrom  *time.Time `json:"valid_from"`  // optional, RFC 3339
	ValidUntil *time.Time `json:"valid_until"` // optional, RFC 3339
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
	// PR-TIME: validate time window if both fields provided.
	if req.ValidFrom != nil && req.ValidUntil != nil && !req.ValidFrom.Before(*req.ValidUntil) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"valid_from valid_until'dan önce olmalı.", errors.New("invalid time window"))
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
		    (item_id, user_id, e2e_dek_wrapped, wrap_nonce, permission,
		     granted_by, revoked_at, valid_from, valid_until)
		VALUES
		    ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, NULL, $7, $8)
		ON CONFLICT (item_id, user_id) DO UPDATE SET
		    e2e_dek_wrapped = EXCLUDED.e2e_dek_wrapped,
		    wrap_nonce      = EXCLUDED.wrap_nonce,
		    permission      = EXCLUDED.permission,
		    granted_by      = EXCLUDED.granted_by,
		    granted_at      = now(),
		    revoked_at      = NULL,
		    valid_from      = EXCLUDED.valid_from,
		    valid_until     = EXCLUDED.valid_until
	`
	if _, err := h.Service.DB.Exec(ctx, upsertSQL,
		itemID, req.UserID, req.DEKWrapped, req.WrapNonce,
		req.Permission, claims.Subject, req.ValidFrom, req.ValidUntil,
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
			"valid_from":     req.ValidFrom,
			"valid_until":    req.ValidUntil,
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

// ---- Group share ---------------------------------------------------------

// shareGroupMemberDEK is one member's wrapped DEK inside a group share request.
// Client wraps the item DEK with each member's X25519 public key.
type shareGroupMemberDEK struct {
	UserID     string `json:"user_id"`
	DEKWrapped []byte `json:"dek_wrapped"` // base64
	WrapNonce  []byte `json:"wrap_nonce"`  // 12 bytes
}

// shareGroupRequest is the body of POST /api/v1/items/{id}/group-shares.
//
// members list must include all current group members so that each gets their
// own e2e_dek_wrapped row in item_shares (E2E model, ADR-0004).
// Members already having an item_shares row get an UPSERT (DEK refresh).
type shareGroupRequest struct {
	GroupID    string                `json:"group_id"`
	Permission string                `json:"permission"` // 'read' | 'write'
	Members    []shareGroupMemberDEK `json:"members"`    // per-member DEK wraps
	ValidFrom  *time.Time            `json:"valid_from"`
	ValidUntil *time.Time            `json:"valid_until"`
}

// ShareGroup implements POST /api/v1/items/{id}/group-shares.
//
// Creates (or upserts) an item_group_shares row AND batch-inserts item_shares
// rows for each group member that provides a DEK wrap. Write permission on the
// item (or admin) required.
func (h *ItemHandlers) ShareGroup(w http.ResponseWriter, r *http.Request) {
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

	var req shareGroupRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.GroupID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"group_id zorunlu.", errors.New("missing group_id"))
		return
	}
	if req.Permission != string(auth.ItemPermRead) && req.Permission != string(auth.ItemPermWrite) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"permission 'read' veya 'write' olmalı.", errors.New("bad permission"))
		return
	}
	if req.ValidFrom != nil && req.ValidUntil != nil && !req.ValidFrom.Before(*req.ValidUntil) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"valid_from valid_until'dan önce olmalı.", errors.New("invalid time window"))
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
				"Bu item'ı paylaşmak için yazma yetkisi gerekli.", errors.New("write denied"))
			return
		}
	}

	// Verify group exists.
	var groupExists bool
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM groups WHERE id = $1::uuid)`, req.GroupID,
	).Scan(&groupExists); err != nil || !groupExists {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Grup bulunamadı.", errors.New("group not found"))
		return
	}

	// Validate member DEK wraps.
	for i, m := range req.Members {
		if m.UserID == "" {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"members[].user_id zorunlu.", errors.New("missing member user_id"))
			return
		}
		if len(m.DEKWrapped) == 0 {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"members[].dek_wrapped zorunlu.", errors.New("missing member dek_wrapped"))
			return
		}
		if len(m.WrapNonce) != crypto.AESGCMNonceLen {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"members[].wrap_nonce 12 byte olmalı.", errors.New("bad nonce length"))
			return
		}
		_ = i
	}

	// Upsert item_group_shares.
	const upsertGroupSQL = `
		INSERT INTO item_group_shares
		    (item_id, group_id, permission, granted_by, revoked_at, valid_from, valid_until)
		VALUES
		    ($1::uuid, $2::uuid, $3, $4::uuid, NULL, $5, $6)
		ON CONFLICT (item_id, group_id) DO UPDATE SET
		    permission  = EXCLUDED.permission,
		    granted_by  = EXCLUDED.granted_by,
		    granted_at  = now(),
		    revoked_at  = NULL,
		    valid_from  = EXCLUDED.valid_from,
		    valid_until = EXCLUDED.valid_until
	`
	if _, err := h.Service.DB.Exec(ctx, upsertGroupSQL,
		itemID, req.GroupID, req.Permission, claims.Subject,
		req.ValidFrom, req.ValidUntil,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup paylaşımı kaydedilemedi.", err)
		return
	}

	// Batch upsert per-member item_shares (E2E DEK wraps).
	const upsertMemberSQL = `
		INSERT INTO item_shares
		    (item_id, user_id, e2e_dek_wrapped, wrap_nonce, permission,
		     granted_by, revoked_at, valid_from, valid_until)
		VALUES
		    ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, NULL, $7, $8)
		ON CONFLICT (item_id, user_id) DO UPDATE SET
		    e2e_dek_wrapped = EXCLUDED.e2e_dek_wrapped,
		    wrap_nonce      = EXCLUDED.wrap_nonce,
		    permission      = EXCLUDED.permission,
		    granted_by      = EXCLUDED.granted_by,
		    granted_at      = now(),
		    revoked_at      = NULL,
		    valid_from      = EXCLUDED.valid_from,
		    valid_until     = EXCLUDED.valid_until
	`
	for _, m := range req.Members {
		if _, err := h.Service.DB.Exec(ctx, upsertMemberSQL,
			itemID, m.UserID, m.DEKWrapped, m.WrapNonce,
			req.Permission, claims.Subject, req.ValidFrom, req.ValidUntil,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Üye DEK wraps kaydedilemedi.", err)
			return
		}
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemGroupShared,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details: map[string]any{
			"group_id":     req.GroupID,
			"permission":   req.Permission,
			"member_count": len(req.Members),
			"valid_from":   req.ValidFrom,
			"valid_until":  req.ValidUntil,
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})
	h.publishEvent(ws.EventItemShared, itemID, claims.Subject)

	w.WriteHeader(http.StatusNoContent)
}

// UnshareGroup implements DELETE /api/v1/items/{id}/group-shares/{group_id}.
//
// Soft-revokes the item_group_shares row. Individual item_shares for group
// members are NOT automatically revoked (they may have been granted independently).
func (h *ItemHandlers) UnshareGroup(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	groupID := chi.URLParam(r, "group_id")
	if itemID == "" || groupID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve group_id zorunlu.", errors.New("missing path params"))
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

	const revokeSQL = `
		UPDATE item_group_shares
		SET revoked_at = now()
		WHERE item_id = $1::uuid AND group_id = $2::uuid AND revoked_at IS NULL
	`
	tag, err := h.Service.DB.Exec(ctx, revokeSQL, itemID, groupID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup paylaşımı kaldırılamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		w.WriteHeader(http.StatusNoContent) // idempotent
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemGroupUnshared,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"group_id": groupID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	h.publishEvent(ws.EventItemUnshared, itemID, claims.Subject)

	w.WriteHeader(http.StatusNoContent)
}
