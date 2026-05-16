package httpapi

// Tag endpoints (PR-N7).
//
// Tags are personal labels owned by the creating user. They can be applied
// to any item the user can read. Favorites are per-user bookmarks.
//
// Routes (all Bearer-protected):
//   GET    /api/v1/tags                          list caller's tags
//   POST   /api/v1/tags                          create tag
//   DELETE /api/v1/tags/{tag_id}                 delete tag (cascade removes item_tags)
//   POST   /api/v1/items/{id}/tags               add tag to item
//   DELETE /api/v1/items/{id}/tags/{tag_id}      remove tag from item
//   GET    /api/v1/items/{id}/tags               list tags on item
//   POST   /api/v1/items/{id}/favorite           add to favorites
//   DELETE /api/v1/items/{id}/favorite           remove from favorites
//   GET    /api/v1/favorites                     list user's favorited items

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// TagHandlers groups the tag + favorite endpoints.
type TagHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// tagResponse is the API representation of a tag.
type tagResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Color     *string `json:"color,omitempty"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
}

type tagListResponse struct {
	Tags []tagResponse `json:"tags"`
}

type createTagRequest struct {
	Name  string  `json:"name"`
	Color *string `json:"color,omitempty"` // "#RRGGBB" or omit
}

// ListTags implements GET /api/v1/tags — returns the caller's tags.
func (h *TagHandlers) ListTags(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()

	const sqlText = `
		SELECT id::text, name, color, created_by::text, created_at::text
		FROM tags WHERE created_by = $1::uuid
		ORDER BY name
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiketler okunamadı.", err)
		return
	}
	defer rows.Close()

	tags := make([]tagResponse, 0)
	for rows.Next() {
		var t tagResponse
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.CreatedBy, &t.CreatedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Etiket satırı okunamadı.", err)
			return
		}
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiket sorgusu başarısız.", err)
		return
	}
	writeJSON(w, http.StatusOK, tagListResponse{Tags: tags})
}

// CreateTag implements POST /api/v1/tags.
func (h *TagHandlers) CreateTag(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req createTagRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 64 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name 1-64 karakter olmalı.", errors.New("invalid name"))
		return
	}

	ctx := r.Context()

	const insertSQL = `
		INSERT INTO tags (name, color, created_by)
		VALUES ($1, $2, $3::uuid)
		RETURNING id::text, name, color, created_by::text, created_at::text
	`
	var t tagResponse
	err := h.Service.DB.QueryRow(ctx, insertSQL, req.Name, req.Color, claims.Subject).
		Scan(&t.ID, &t.Name, &t.Color, &t.CreatedBy, &t.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu isimde bir etiket zaten var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiket oluşturulamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionTagCreated,
		ResourceType: "tag",
		ResourceID:   t.ID,
		Details:      map[string]any{"name": t.Name},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, t)
}

// DeleteTag implements DELETE /api/v1/tags/{tag_id}.
func (h *TagHandlers) DeleteTag(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	tagID := chi.URLParam(r, "tag_id")
	ctx := r.Context()

	// Only the owner can delete their tag.
	tag, err := h.Service.DB.Exec(ctx,
		`DELETE FROM tags WHERE id = $1::uuid AND created_by = $2::uuid`,
		tagID, claims.Subject,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiket silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Etiket bulunamadı.", errors.New("not found or not owner"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionTagDeleted,
		ResourceType: "tag",
		ResourceID:   tagID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	w.WriteHeader(http.StatusNoContent)
}

// --- Item Tags ---

type itemTagsResponse struct {
	Tags []tagResponse `json:"tags"`
}

type addTagRequest struct {
	TagID string `json:"tag_id"`
}

// ListItemTags implements GET /api/v1/items/{id}/tags.
func (h *TagHandlers) ListItemTags(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	// Need at least Read on the item.
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", errors.New("denied"))
			return
		}
	}

	const sqlText = `
		SELECT t.id::text, t.name, t.color, t.created_by::text, t.created_at::text
		FROM tags t
		JOIN item_tags it ON it.tag_id = t.id
		WHERE it.item_id = $1::uuid
		ORDER BY t.name
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item etiketleri okunamadı.", err)
		return
	}
	defer rows.Close()

	tags := make([]tagResponse, 0)
	for rows.Next() {
		var t tagResponse
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.CreatedBy, &t.CreatedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Etiket satırı okunamadı.", err)
			return
		}
		tags = append(tags, t)
	}
	writeJSON(w, http.StatusOK, itemTagsResponse{Tags: tags})
}

// AddItemTag implements POST /api/v1/items/{id}/tags.
func (h *TagHandlers) AddItemTag(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")

	var req addTagRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.TagID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"tag_id zorunlu.", errors.New("missing tag_id"))
		return
	}

	ctx := r.Context()

	// Need at least Read on the item to tag it.
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", errors.New("denied"))
			return
		}
	}

	_, err := h.Service.DB.Exec(ctx,
		`INSERT INTO item_tags (item_id, tag_id, tagged_by)
		 VALUES ($1::uuid, $2::uuid, $3::uuid)
		 ON CONFLICT DO NOTHING`,
		itemID, req.TagID, claims.Subject,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiket eklenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemTagged,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"tag_id": req.TagID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	w.WriteHeader(http.StatusNoContent)
}

// RemoveItemTag implements DELETE /api/v1/items/{id}/tags/{tag_id}.
func (h *TagHandlers) RemoveItemTag(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	tagID := chi.URLParam(r, "tag_id")
	ctx := r.Context()

	_, err := h.Service.DB.Exec(ctx,
		`DELETE FROM item_tags WHERE item_id = $1::uuid AND tag_id = $2::uuid`,
		itemID, tagID,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Etiket kaldırılamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemUntagged,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"tag_id": tagID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	w.WriteHeader(http.StatusNoContent)
}

// --- Favorites ---

type favoriteItemRow struct {
	ID                   string
	FolderID             string
	ItemTypeID           int16
	NameEnc              []byte
	ServerDEKWrapped     []byte
	Description          *string
	CreatedBy            string
	CreatedAt            string
	UpdatedAt            string
	ExpiresAt            *string
	RotationIntervalDays *int
	LastRotatedAt        *string
	PinnedAt             string
}

type favoriteItemResponse struct {
	itemResponse
	PinnedAt string `json:"pinned_at"`
}

type favoritesListResponse struct {
	Items []favoriteItemResponse `json:"items"`
}

// AddFavorite implements POST /api/v1/items/{id}/favorite.
func (h *TagHandlers) AddFavorite(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	_, err := h.Service.DB.Exec(ctx,
		`INSERT INTO user_favorites (user_id, item_id)
		 VALUES ($1::uuid, $2::uuid)
		 ON CONFLICT DO NOTHING`,
		claims.Subject, itemID,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Favorilere eklenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemFavorited,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	w.WriteHeader(http.StatusNoContent)
}

// RemoveFavorite implements DELETE /api/v1/items/{id}/favorite.
func (h *TagHandlers) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	_, err := h.Service.DB.Exec(ctx,
		`DELETE FROM user_favorites WHERE user_id = $1::uuid AND item_id = $2::uuid`,
		claims.Subject, itemID,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Favorilerden kaldırılamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemUnfavorited,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	w.WriteHeader(http.StatusNoContent)
}

// ListFavorites implements GET /api/v1/favorites.
//
// Returns items the caller has favorited, in pinned_at DESC order.
// Only returns items the caller still has permission to read.
func (h *TagHandlers) ListFavorites(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()

	const sqlText = `
		SELECT
		    i.id::text, i.folder_id::text, i.item_type_id,
		    i.name_enc, i.server_dek_wrapped,
		    i.description,
		    i.created_by::text, i.created_at::text, i.updated_at::text,
		    i.expires_at::text, i.rotation_interval_days, i.last_rotated_at::text,
		    uf.pinned_at::text
		FROM user_favorites uf
		JOIN items i ON i.id = uf.item_id
		WHERE uf.user_id = $1::uuid
		ORDER BY uf.pinned_at DESC
		LIMIT 200
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Favoriler okunamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]favoriteItemResponse, 0)
	for rows.Next() {
		var row favoriteItemRow
		if err := rows.Scan(
			&row.ID, &row.FolderID, &row.ItemTypeID,
			&row.NameEnc, &row.ServerDEKWrapped,
			&row.Description,
			&row.CreatedBy, &row.CreatedAt, &row.UpdatedAt,
			&row.ExpiresAt, &row.RotationIntervalDays, &row.LastRotatedAt,
			&row.PinnedAt,
		); err != nil {
			h.Logger.Warn("favorites scan failed", slog.String("error", err.Error()))
			continue
		}

		// Permission check — favorited item may have been un-shared since.
		var perm auth.ItemPermission
		if hasRole(claims, RoleAdmin) {
			perm = auth.ItemPermWrite
		} else {
			p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, row.ID)
			if err != nil || p == auth.ItemPermNone {
				continue // silently skip inaccessible items
			}
			perm = p
		}

		name, err := decryptItemName(h.Service, row.ID, row.ServerDEKWrapped, row.NameEnc)
		if err != nil {
			h.Logger.Warn("favorites name decrypt failed", slog.String("item_id", row.ID))
			continue
		}

		out = append(out, favoriteItemResponse{
			itemResponse: itemResponse{
				ID:                   row.ID,
				FolderID:             row.FolderID,
				ItemTypeID:           row.ItemTypeID,
				Name:                 name,
				Description:          row.Description,
				Fields:               []itemFieldOutput{},
				CreatedBy:            row.CreatedBy,
				CreatedAt:            row.CreatedAt,
				UpdatedAt:            row.UpdatedAt,
				Permission:           perm,
				ExpiresAt:            row.ExpiresAt,
				RotationIntervalDays: row.RotationIntervalDays,
				LastRotatedAt:        row.LastRotatedAt,
			},
			PinnedAt: row.PinnedAt,
		})
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Favori sorgusu başarısız.", err)
		return
	}

	writeJSON(w, http.StatusOK, favoritesListResponse{Items: out})
}

// IsFavorite implements GET /api/v1/items/{id}/favorite — returns 204 if favorited, 404 if not.
func (h *TagHandlers) IsFavorite(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	var exists bool
	err := h.Service.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM user_favorites WHERE user_id = $1::uuid AND item_id = $2::uuid)`,
		claims.Subject, itemID,
	).Scan(&exists)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Favori durumu sorgulanamadı.", err)
		return
	}
	if !exists {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Favorilerde değil.", errors.New("not favorited"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
