package httpapi

// item_templates.go — PR-TPL: User-defined item templates.
//
// Endpoints:
//   GET    /api/v1/templates?scope=mine|public|all  — list templates
//   POST   /api/v1/templates                        — create template
//   PUT    /api/v1/templates/{id}                   — update (owner or admin)
//   DELETE /api/v1/templates/{id}                   — delete (owner or admin)
//   POST   /api/v1/items/{id}/save-as-template      — save item as template
//
// Access:
//   - Any authenticated user can create a template.
//   - Public templates are readable by all; private templates only by owner/admin.
//   - Only owner or admin can update/delete.

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// TemplateHandlers groups item template HTTP handlers.
type TemplateHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// templateResponse is the JSON body for a single template.
type templateResponse struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	ItemTypeID  int             `json:"item_type_id"`
	Fields      json.RawMessage `json:"fields"`
	Tags        []string        `json:"tags"`
	IsPublic    bool            `json:"is_public"`
	CreatedBy   string          `json:"created_by"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

// createTemplateRequest is the body for POST /api/v1/templates.
type createTemplateRequest struct {
	Name        string          `json:"name"`
	Description *string         `json:"description"`
	ItemTypeID  int             `json:"item_type_id"`
	Fields      json.RawMessage `json:"fields"`
	Tags        []string        `json:"tags"`
	IsPublic    bool            `json:"is_public"`
}

// updateTemplateRequest is the body for PUT /api/v1/templates/{id}.
type updateTemplateRequest struct {
	Name        string          `json:"name"`
	Description *string         `json:"description"`
	Fields      json.RawMessage `json:"fields"`
	Tags        []string        `json:"tags"`
	IsPublic    bool            `json:"is_public"`
}

// List implements GET /api/v1/templates?scope=mine|public|all.
func (h *TemplateHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	scope := strings.ToLower(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "public"
	}

	ctx := r.Context()
	userID := claims.Subject
	isAdmin := hasRole(claims, RoleAdmin)

	var (
		q    string
		args []any
	)

	const base = `
		SELECT id::text, name, description, item_type_id, fields, tags,
		       is_public, created_by::text, created_at::text, updated_at::text
		FROM item_templates
	`

	switch scope {
	case "mine":
		q = base + `WHERE created_by = $1::uuid ORDER BY name`
		args = []any{userID}
	case "all":
		if !isAdmin {
			// Non-admins see mine + public.
			q = base + `WHERE is_public = true OR created_by = $1::uuid ORDER BY is_public DESC, name`
			args = []any{userID}
		} else {
			q = base + `ORDER BY is_public DESC, name`
		}
	default: // "public"
		q = base + `WHERE is_public = true ORDER BY name`
	}

	rows, err := h.Service.DB.Query(ctx, q, args...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablonlar yüklenemedi.", err)
		return
	}
	defer rows.Close()

	templates := make([]templateResponse, 0, 32)
	for rows.Next() {
		var t templateResponse
		var fields []byte
		if err := rows.Scan(
			&t.ID, &t.Name, &t.Description, &t.ItemTypeID,
			&fields, &t.Tags, &t.IsPublic, &t.CreatedBy,
			&t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Şablon okunamadı.", err)
			return
		}
		if t.Tags == nil {
			t.Tags = []string{}
		}
		t.Fields = json.RawMessage(fields)
		templates = append(templates, t)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon okuma hatası.", rows.Err())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

// Create implements POST /api/v1/templates.
func (h *TemplateHandlers) Create(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req createTemplateRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Şablon adı zorunlu.", nil)
		return
	}
	if req.ItemTypeID == 0 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item_type_id zorunlu.", nil)
		return
	}
	if req.Fields == nil {
		req.Fields = json.RawMessage("[]")
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}

	ctx := r.Context()
	userID := claims.Subject

	var id string
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO item_templates (name, description, item_type_id, fields, tags, is_public, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
		RETURNING id::text
	`, req.Name, req.Description, req.ItemTypeID, []byte(req.Fields), req.Tags, req.IsPublic, userID,
	).Scan(&id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon oluşturulamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: userID,
		Action:      "template.created",
		ResourceID:  id,
		Details:     map[string]any{"name": req.Name, "is_public": req.IsPublic},
	})

	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// Update implements PUT /api/v1/templates/{id}.
func (h *TemplateHandlers) Update(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	tplID := chi.URLParam(r, "id")
	if tplID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"template id zorunlu.", errors.New("missing id"))
		return
	}

	var req updateTemplateRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Şablon adı zorunlu.", nil)
		return
	}
	if req.Fields == nil {
		req.Fields = json.RawMessage("[]")
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}

	ctx := r.Context()
	userID := claims.Subject
	isAdmin := hasRole(claims, RoleAdmin)

	// Verify ownership.
	var ownerID string
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT created_by::text FROM item_templates WHERE id = $1::uuid`, tplID,
	).Scan(&ownerID); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Şablon bulunamadı.", err)
		return
	}
	if !isAdmin && ownerID != userID {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Bu şablonu düzenleme yetkiniz yok.", nil)
		return
	}

	_, err := h.Service.DB.Exec(ctx, `
		UPDATE item_templates
		SET name=$2, description=$3, fields=$4, tags=$5, is_public=$6
		WHERE id = $1::uuid
	`, tplID, req.Name, req.Description, []byte(req.Fields), req.Tags, req.IsPublic)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon güncellenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: userID,
		Action:      "template.updated",
		ResourceID:  tplID,
		Details:     map[string]any{"name": req.Name, "is_public": req.IsPublic},
	})

	w.WriteHeader(http.StatusNoContent)
}

// Delete implements DELETE /api/v1/templates/{id}.
func (h *TemplateHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	tplID := chi.URLParam(r, "id")
	if tplID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"template id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()
	userID := claims.Subject
	isAdmin := hasRole(claims, RoleAdmin)

	// Verify ownership before delete.
	var ownerID string
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT created_by::text FROM item_templates WHERE id = $1::uuid`, tplID,
	).Scan(&ownerID); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Şablon bulunamadı.", err)
		return
	}
	if !isAdmin && ownerID != userID {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Bu şablonu silme yetkiniz yok.", nil)
		return
	}

	if _, err := h.Service.DB.Exec(ctx,
		`DELETE FROM item_templates WHERE id = $1::uuid`, tplID,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şablon silinemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: userID,
		Action:      "template.deleted",
		ResourceID:  tplID,
	})

	w.WriteHeader(http.StatusNoContent)
}
