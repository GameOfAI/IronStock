package httpapi

// item_links.go — PR-LINK: Linked Entries
//
// Items can be "linked" so that a field update on one item (source) propagates
// to the linked field on other items (targets).
//
// E2E encryption constraint: the server never sees plaintext field values.
// Propagation is therefore client-driven:
//  1. Client updates source item (PUT /api/v1/items/{id}).
//  2. Server response includes `mirror_link_ids` — IDs of link records that
//     need propagation.
//  3. Client re-encrypts the field value for each target item's DEK and
//     calls PUT /api/v1/items/{target_id} with the updated field payload.
//
// Two link types:
//   - "mirror"    — propagation expected; link records appear in mirror_link_ids.
//   - "reference" — visual link only; no propagation.

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// --- Request / response types ---

type createLinkRequest struct {
	TargetItemID      string `json:"target_item_id"`
	SourceFieldDefID  string `json:"source_field_def_id"`
	TargetFieldDefID  string `json:"target_field_def_id"`
	LinkType          string `json:"link_type"` // "mirror" | "reference"
}

type itemLinkEntry struct {
	ID                 string    `json:"id"`
	SourceItemID       string    `json:"source_item_id"`
	SourceFieldDefID   string    `json:"source_field_def_id"`
	TargetItemID       string    `json:"target_item_id"`
	TargetItemName     string    `json:"target_item_name"`  // decrypted server-side name_plain
	TargetFieldDefID   string    `json:"target_field_def_id"`
	TargetFieldDefName string    `json:"target_field_def_name"`
	LinkType           string    `json:"link_type"`
	CreatedBy          string    `json:"created_by"`
	CreatedAt          time.Time `json:"created_at"`
}

// --- CreateLink: POST /api/v1/items/{id}/links ---

// CreateLink creates a directional field link from {id} → target_item_id.
// Requires Write permission on both source and target items.
func (h *ItemHandlers) CreateLink(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	sourceID := chi.URLParam(r, "id")
	if sourceID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"source item id zorunlu.", errors.New("missing id"))
		return
	}

	var req createLinkRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.TargetItemID == "" || req.SourceFieldDefID == "" || req.TargetFieldDefID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"target_item_id, source_field_def_id, target_field_def_id zorunlu.", errors.New("missing fields"))
		return
	}
	if req.LinkType != "mirror" && req.LinkType != "reference" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"link_type 'mirror' veya 'reference' olmalı.", errors.New("invalid link_type"))
		return
	}

	ctx := r.Context()
	userID := claims.Subject

	// Check write permission on source item.
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, sourceID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Kaynak item için yazma yetkisi gerekli.", nil)
			return
		}
	}

	// Check at least read permission on target item.
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, req.TargetItemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Hedef item'a erişim yetkisi yok.", nil)
			return
		}
	}

	// Insert the link.
	var linkID string
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO item_links (
			source_item_id, source_field_def_id,
			target_item_id, target_field_def_id,
			link_type, created_by
		)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid)
		ON CONFLICT ON CONSTRAINT uq_item_links DO NOTHING
		RETURNING id::text
	`,
		sourceID, req.SourceFieldDefID,
		req.TargetItemID, req.TargetFieldDefID,
		req.LinkType, userID,
	).Scan(&linkID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bağlantı oluşturulamadı.", err)
		return
	}
	if linkID == "" {
		// ON CONFLICT DO NOTHING triggered — link already exists.
		writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
			"Bu alan çifti zaten bağlı.", nil)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "item.link_created",
		ResourceType: audit.ResourceItem,
		ResourceID:   sourceID,
		Details: map[string]any{
			"link_id":             linkID,
			"target_item_id":      req.TargetItemID,
			"source_field_def_id": req.SourceFieldDefID,
			"target_field_def_id": req.TargetFieldDefID,
			"link_type":           req.LinkType,
		},
	})

	h.publishEvent("item.updated", sourceID, userID)
	writeJSON(w, http.StatusCreated, map[string]string{"id": linkID})
}

// --- ListLinks: GET /api/v1/items/{id}/links ---

// ListLinks returns all links where {id} is the source item.
// Requires at least Read permission on the source item.
func (h *ItemHandlers) ListLinks(w http.ResponseWriter, r *http.Request) {
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
	userID := claims.Subject

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Bu item'a erişim yetkisi yok.", nil)
			return
		}
	}

	rows, err := h.Service.DB.Query(ctx, `
		SELECT
			il.id::text,
			il.source_item_id::text,
			il.source_field_def_id::text,
			il.target_item_id::text,
			COALESCE(ti.name_plain, ''),
			il.target_field_def_id::text,
			COALESCE(tfd.label, ''),
			il.link_type,
			il.created_by::text,
			il.created_at
		FROM item_links il
		LEFT JOIN items ti ON ti.id = il.target_item_id
		LEFT JOIN field_definitions tfd ON tfd.id = il.target_field_def_id
		WHERE il.source_item_id = $1::uuid
		ORDER BY il.created_at DESC
	`, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bağlantılar alınamadı.", err)
		return
	}
	defer rows.Close()

	links := []itemLinkEntry{}
	for rows.Next() {
		var e itemLinkEntry
		if err := rows.Scan(
			&e.ID, &e.SourceItemID, &e.SourceFieldDefID,
			&e.TargetItemID, &e.TargetItemName,
			&e.TargetFieldDefID, &e.TargetFieldDefName,
			&e.LinkType, &e.CreatedBy, &e.CreatedAt,
		); err != nil {
			continue
		}
		links = append(links, e)
	}

	writeJSON(w, http.StatusOK, map[string]any{"links": links})
}

// --- DeleteLink: DELETE /api/v1/items/{id}/links/{link_id} ---

// DeleteLink removes a link by ID.
// Requires Write permission on the source item, or Admin.
func (h *ItemHandlers) DeleteLink(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	linkID := chi.URLParam(r, "link_id")
	if itemID == "" || linkID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item id ve link id zorunlu.", errors.New("missing params"))
		return
	}

	ctx := r.Context()
	userID := claims.Subject

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Bağlantı silmek için yazma yetkisi gerekli.", nil)
			return
		}
	}

	tag, err := h.Service.DB.Exec(ctx, `
		DELETE FROM item_links
		WHERE id = $1::uuid AND source_item_id = $2::uuid
	`, linkID, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bağlantı silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Bağlantı bulunamadı.", nil)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "item.link_removed",
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"link_id": linkID},
	})

	h.publishEvent("item.updated", itemID, userID)
	w.WriteHeader(http.StatusNoContent)
}

// --- Helper ---

// queryMirrorLinkIDs returns the IDs of all "mirror" links where itemID is the
// source. Used by the item Update handler to inform the client which linked
// targets need field propagation. Returns an empty slice on error (fail-open).
func queryMirrorLinkIDs(ctx context.Context, db *pgxpool.Pool, itemID string) []string {
	rows, err := db.Query(ctx, `
		SELECT id::text
		FROM item_links
		WHERE source_item_id = $1::uuid AND link_type = 'mirror'
	`, itemID)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

