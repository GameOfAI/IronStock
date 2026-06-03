package httpapi

// Portal template endpoints — PR-DP11.
// Golden Path scaffold blueprints: kind + default annotations + lifecycle + relations.
//
// Routes (Bearer-protected):
//   GET    /api/v1/portal-templates          — list (filterable by ?kind_key=)
//   GET    /api/v1/portal-templates/{id}     — single template
//   POST   /api/v1/portal-templates          — create (admin only)
//   PUT    /api/v1/portal-templates/{id}     — update (admin only)
//   DELETE /api/v1/portal-templates/{id}     — delete (admin only; builtin blocked)

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PortalTemplateHandlers groups portal template endpoints.
type PortalTemplateHandlers struct {
	DB     *pgxpool.Pool
	Logger *slog.Logger
}

type portalTemplateRow struct {
	ID                    string          `json:"id"`
	Name                  string          `json:"name"`
	Description           *string         `json:"description,omitempty"`
	KindKey               string          `json:"kind_key"`
	ItemTypeID            *int            `json:"item_type_id,omitempty"`
	DefaultFields         json.RawMessage `json:"default_fields,omitempty"`
	DefaultAnnotations    json.RawMessage `json:"default_annotations,omitempty"`
	DefaultLifecycleStages []string       `json:"default_lifecycle_stages,omitempty"`
	DefaultRelations      json.RawMessage `json:"default_relations,omitempty"`
	IsBuiltin             bool            `json:"is_builtin"`
	IsActive              bool            `json:"is_active"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
}

type portalTemplateListResponse struct {
	Templates []portalTemplateRow `json:"templates"`
}

type createPortalTemplateRequest struct {
	Name                   string          `json:"name"`
	Description            *string         `json:"description"`
	KindKey                string          `json:"kind_key"`
	ItemTypeID             *int            `json:"item_type_id"`
	DefaultFields          json.RawMessage `json:"default_fields"`
	DefaultAnnotations     json.RawMessage `json:"default_annotations"`
	DefaultLifecycleStages []string        `json:"default_lifecycle_stages"`
	DefaultRelations       json.RawMessage `json:"default_relations"`
}

const templateSelect = `
	SELECT id, name, description, kind_key, item_type_id,
	       default_fields, default_annotations,
	       default_lifecycle_stages, default_relations,
	       is_builtin, is_active, created_at, updated_at
	FROM portal_templates`

func scanTemplate(row pgx.CollectableRow) (portalTemplateRow, error) {
	var t portalTemplateRow
	var stagePtrs []*string
	var defaultFields, defaultAnnotations, defaultRelations *json.RawMessage
	err := row.Scan(
		&t.ID, &t.Name, &t.Description, &t.KindKey, &t.ItemTypeID,
		&defaultFields, &defaultAnnotations,
		&stagePtrs, &defaultRelations,
		&t.IsBuiltin, &t.IsActive, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return t, err
	}
	if defaultFields != nil {
		t.DefaultFields = *defaultFields
	}
	if defaultAnnotations != nil {
		t.DefaultAnnotations = *defaultAnnotations
	}
	if defaultRelations != nil {
		t.DefaultRelations = *defaultRelations
	}
	t.DefaultLifecycleStages = make([]string, 0, len(stagePtrs))
	for _, p := range stagePtrs {
		if p != nil {
			t.DefaultLifecycleStages = append(t.DefaultLifecycleStages, *p)
		}
	}
	return t, nil
}

// ListPortalTemplates implements GET /api/v1/portal-templates.
// Optional query param: ?kind_key=Server
func (h *PortalTemplateHandlers) ListPortalTemplates(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	kindKey := strings.TrimSpace(r.URL.Query().Get("kind_key"))
	showAll := r.URL.Query().Get("all") == "true" && hasRole(claims, RoleAdmin)

	var rows pgx.Rows
	var err error
	if kindKey != "" && showAll {
		rows, err = h.DB.Query(ctx,
			templateSelect+` WHERE kind_key = $1 ORDER BY is_builtin DESC, name`,
			kindKey,
		)
	} else if kindKey != "" {
		rows, err = h.DB.Query(ctx,
			templateSelect+` WHERE is_active = true AND kind_key = $1 ORDER BY is_builtin DESC, name`,
			kindKey,
		)
	} else if showAll {
		rows, err = h.DB.Query(ctx,
			templateSelect+` ORDER BY is_builtin DESC, name`,
		)
	} else {
		rows, err = h.DB.Query(ctx,
			templateSelect+` WHERE is_active = true ORDER BY is_builtin DESC, name`,
		)
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablonlar okunamadı.", err)
		return
	}
	defer rows.Close()

	templates := make([]portalTemplateRow, 0)
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veri okunamadı.", err)
			return
		}
		templates = append(templates, t)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veri okunamadı.", rows.Err())
		return
	}
	writeJSON(w, http.StatusOK, portalTemplateListResponse{Templates: templates})
}

// GetPortalTemplate implements GET /api/v1/portal-templates/{id}.
func (h *PortalTemplateHandlers) GetPortalTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	id := chi.URLParam(r, "id")
	row, err := h.DB.Query(ctx, templateSelect+` WHERE id = $1`, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon okunamadı.", err)
		return
	}
	defer row.Close()

	if !row.Next() {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Şablon bulunamadı.", nil)
		return
	}
	t, err := scanTemplate(row)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veri okunamadı.", err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// CreatePortalTemplate implements POST /api/v1/portal-templates. Admin only.
func (h *PortalTemplateHandlers) CreatePortalTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req createPortalTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON.", err)
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.KindKey) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"name ve kind_key zorunludur.", nil)
		return
	}

	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO portal_templates
		  (name, description, kind_key, item_type_id,
		   default_fields, default_annotations, default_lifecycle_stages,
		   default_relations, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id`,
		strings.TrimSpace(req.Name), req.Description, strings.TrimSpace(req.KindKey),
		req.ItemTypeID, nullableJSON(req.DefaultFields), nullableJSON(req.DefaultAnnotations),
		req.DefaultLifecycleStages, nullableJSON(req.DefaultRelations),
		claims.Subject,
	).Scan(&id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon kaydedilemedi.", err)
		return
	}

	w.Header().Set("Location", "/api/v1/portal-templates/"+id)
	w.WriteHeader(http.StatusCreated)
}

// UpdatePortalTemplate implements PUT /api/v1/portal-templates/{id}. Admin only.
func (h *PortalTemplateHandlers) UpdatePortalTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	id := chi.URLParam(r, "id")

	var isBuiltin bool
	err := h.DB.QueryRow(ctx, `SELECT is_builtin FROM portal_templates WHERE id = $1`, id).
		Scan(&isBuiltin)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Şablon bulunamadı.", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Sorgu hatası.", err)
		return
	}

	var req createPortalTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON.", err)
		return
	}

	_, err = h.DB.Exec(ctx, `
		UPDATE portal_templates SET
		  name = $1, description = $2, kind_key = $3, item_type_id = $4,
		  default_fields = $5, default_annotations = $6,
		  default_lifecycle_stages = $7, default_relations = $8,
		  updated_at = NOW()
		WHERE id = $9`,
		strings.TrimSpace(req.Name), req.Description, strings.TrimSpace(req.KindKey),
		req.ItemTypeID, nullableJSON(req.DefaultFields), nullableJSON(req.DefaultAnnotations),
		req.DefaultLifecycleStages, nullableJSON(req.DefaultRelations),
		id,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon güncellenemedi.", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeletePortalTemplate implements DELETE /api/v1/portal-templates/{id}. Admin only.
// Built-in templates cannot be deleted.
func (h *PortalTemplateHandlers) DeletePortalTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	id := chi.URLParam(r, "id")

	var isBuiltin bool
	err := h.DB.QueryRow(ctx, `SELECT is_builtin FROM portal_templates WHERE id = $1`, id).
		Scan(&isBuiltin)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Şablon bulunamadı.", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Sorgu hatası.", err)
		return
	}
	if isBuiltin {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Yerleşik (builtin) şablonlar silinemez.", nil)
		return
	}

	_, err = h.DB.Exec(ctx, `DELETE FROM portal_templates WHERE id = $1`, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon silinemedi.", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

