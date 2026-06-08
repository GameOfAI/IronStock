package httpapi

// Catalog entity endpoint — PR-DP-E1.
// Returns item + annotations + relationships + health in a single response.
//
// GET /api/v1/catalog/{kind}/{name}

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/health"
)

type CatalogEntityHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

type catalogEntityResponse struct {
	Item          catalogEntityItem   `json:"item"`
	Annotations   map[string]string   `json:"annotations"`
	Relationships []graphEdge         `json:"relationships"`
	Health        *ItemHealthResponse `json:"health,omitempty"`
}

type catalogEntityItem struct {
	ID          string    `json:"id"`
	FolderID    string    `json:"folder_id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Kind        string    `json:"kind"`
	ItemTypeID  int16     `json:"item_type_id"`
	OwnerRef    *ownerRef `json:"owner_ref,omitempty"`
	CreatedAt   string    `json:"created_at"`
	UpdatedAt   string    `json:"updated_at"`
	ExpiresAt   *string   `json:"expires_at,omitempty"`
}

// GetEntity implements GET /api/v1/catalog/{kind}/{name}.
func (h *CatalogEntityHandlers) GetEntity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	kindKey := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")
	if kindKey == "" || name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"kind ve name parametreleri zorunludur.", nil)
		return
	}

	// Step 1: Find item by kind_key + name_plain
	var item catalogEntityItem
	var folderID string
	var ownerUsername *string
	var expiresAt *time.Time
	var lastRotatedAt *time.Time
	var rotInterval *int
	var hasTags bool
	var relCount int
	var k8sBound bool
	var description *string

	err := h.Service.DB.QueryRow(ctx, `
		SELECT i.id::text, i.folder_id::text, COALESCE(i.name_plain, ''),
		       i.description, COALESCE(it.kind_key, ''), i.item_type_id,
		       u.username,
		       i.created_at::text, i.updated_at::text,
		       i.expires_at, i.last_rotated_at, i.rotation_interval_days,
		       (SELECT COUNT(*) > 0 FROM item_tags tg WHERE tg.item_id = i.id),
		       (SELECT COUNT(*) FROM item_relationships ir
		        WHERE ir.source_item_id = i.id OR ir.target_item_id = i.id),
		       (SELECT COUNT(*) > 0 FROM item_k8s_bindings kb WHERE kb.item_id = i.id)
		FROM items i
		JOIN item_types it ON it.id = i.item_type_id
		LEFT JOIN users u ON u.id = i.created_by
		WHERE it.kind_key = $1 AND i.name_plain = $2
		LIMIT 1
	`, kindKey, name).Scan(
		&item.ID, &folderID, &item.Name,
		&description, &item.Kind, &item.ItemTypeID,
		&ownerUsername,
		&item.CreatedAt, &item.UpdatedAt,
		&expiresAt, &lastRotatedAt, &rotInterval,
		&hasTags, &relCount, &k8sBound,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Entity bulunamadı.", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Entity sorgulanamadı.", err)
		return
	}

	item.FolderID = folderID
	if description != nil {
		item.Description = *description
	}
	if expiresAt != nil {
		s := expiresAt.Format(time.RFC3339)
		item.ExpiresAt = &s
	}
	if ownerUsername != nil {
		item.OwnerRef = &ownerRef{Kind: "User", Name: *ownerUsername}
	}

	// Permission check
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, folderID)
		if err != nil || perm == "" {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Entity bulunamadı.", nil)
			return
		}
	}

	// Step 2: Annotations
	annotations := make(map[string]string)
	annRows, err := h.Service.DB.Query(ctx, `
		SELECT key, value FROM item_annotations WHERE item_id = $1 ORDER BY key
	`, item.ID)
	if err == nil {
		defer annRows.Close()
		for annRows.Next() {
			var k, v string
			if err := annRows.Scan(&k, &v); err == nil {
				annotations[k] = v
			}
		}
	}

	// Step 3: Relationships
	relationships := make([]graphEdge, 0)
	relRows, err := h.Service.DB.Query(ctx, `
		SELECT source_item_id::text, target_item_id::text, relation_type, metadata
		FROM item_relationships
		WHERE source_item_id::text = $1 OR target_item_id::text = $1
	`, item.ID)
	if err == nil {
		defer relRows.Close()
		for relRows.Next() {
			var e graphEdge
			if err := relRows.Scan(&e.SourceID, &e.TargetID, &e.Type, &e.Metadata); err == nil {
				if bt, ok := backstageTypeMap[e.Type]; ok {
					e.BackstageType = bt
				}
				relationships = append(relationships, e)
			}
		}
	}

	// Step 4: Health score
	meta := health.ItemMeta{
		ID:                   item.ID,
		ExpiresAt:            expiresAt,
		LastRotatedAt:        lastRotatedAt,
		RotationIntervalDays: rotInterval,
		Description:          item.Description,
		HasTags:              hasTags,
		RelationshipCount:    relCount,
		K8sBindingExists:     k8sBound,
		K8sClusterReachable:  true,
	}
	score, breakdown := health.ScoreWithBreakdown(meta, time.Now())
	severity := health.Severity(score)

	resp := catalogEntityResponse{
		Item:          item,
		Annotations:   annotations,
		Relationships: relationships,
		Health: &ItemHealthResponse{
			ItemID:    item.ID,
			Score:     score,
			Severity:  severity,
			Breakdown: breakdown,
		},
	}

	writeJSON(w, http.StatusOK, resp)
}
