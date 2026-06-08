package httpapi

// Item annotation endpoints — PR-DP01.
// Backstage metadata.annotations karşılığı: her item'a freeform key-value
// annotation eklenebilir (ör. grafana/dashboard-url, github.com/project-slug).
//
// Routes (Bearer-protected):
//   GET    /api/v1/items/{id}/annotations          — tüm annotation'ları listele
//   PUT    /api/v1/items/{id}/annotations/{key}    — annotation oluştur/güncelle (upsert)
//   DELETE /api/v1/items/{id}/annotations/{key}    — annotation sil

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/auth"
)

// AnnotationHandlers groups item annotation endpoints.
type AnnotationHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

type annotationResponse struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
}

type annotationListResponse struct {
	Annotations []annotationResponse `json:"annotations"`
}

type upsertAnnotationRequest struct {
	Value string `json:"value"`
}

// ListAnnotations implements GET /api/v1/items/{id}/annotations.
// Requires at least read permission on the item.
func (h *AnnotationHandlers) ListAnnotations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")

	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız.", err)
		return
	}
	if !perm.AllowsRead() {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı.", nil)
		return
	}

	rows, err := h.Service.DB.Query(ctx, `
		SELECT key, value, created_at::text
		FROM item_annotations
		WHERE item_id = $1
		ORDER BY key
	`, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Annotation'lar okunamadı.", err)
		return
	}
	defer rows.Close()

	annotations := make([]annotationResponse, 0)
	for rows.Next() {
		var a annotationResponse
		if err := rows.Scan(&a.Key, &a.Value, &a.CreatedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veri okunamadı.", err)
			return
		}
		annotations = append(annotations, a)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veri okunamadı.", rows.Err())
		return
	}

	writeJSON(w, http.StatusOK, annotationListResponse{Annotations: annotations})
}

// UpsertAnnotation implements PUT /api/v1/items/{id}/annotations/{key}.
// Creates or replaces an annotation. Requires write permission on the item.
// Key must be 1-256 chars; value must be ≤4096 chars.
func (h *AnnotationHandlers) UpsertAnnotation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	rawKey := chi.URLParam(r, "key")
	key, err := url.PathUnescape(rawKey)
	if err != nil || strings.TrimSpace(key) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz annotation key.", nil)
		return
	}
	if len(key) > 256 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"Annotation key en fazla 256 karakter olabilir.", nil)
		return
	}

	var req upsertAnnotationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz JSON.", err)
		return
	}
	if len(req.Value) > 4096 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"Annotation değeri en fazla 4096 karakter olabilir.", nil)
		return
	}

	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız.", err)
		return
	}
	if !perm.AllowsWrite() {
		if perm == auth.ItemPermNone {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Item bulunamadı.", nil)
			return
		}
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Yazma izni gerekli.", nil)
		return
	}

	var out annotationResponse
	err = h.Service.DB.QueryRow(ctx, `
		INSERT INTO item_annotations (item_id, key, value)
		VALUES ($1, $2, $3)
		ON CONFLICT (item_id, key) DO UPDATE SET value = EXCLUDED.value, created_at = now()
		RETURNING key, value, created_at::text
	`, itemID, key, req.Value).Scan(&out.Key, &out.Value, &out.CreatedAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Annotation kaydedilemedi.", err)
		return
	}

	writeJSON(w, http.StatusOK, out)
}

// DeleteAnnotation implements DELETE /api/v1/items/{id}/annotations/{key}.
// Requires write permission on the item. Returns 204 even if key did not exist.
func (h *AnnotationHandlers) DeleteAnnotation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	rawKey := chi.URLParam(r, "key")
	key, err := url.PathUnescape(rawKey)
	if err != nil || strings.TrimSpace(key) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz annotation key.", nil)
		return
	}

	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız.", err)
		return
	}
	if !perm.AllowsWrite() {
		if perm == auth.ItemPermNone {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Item bulunamadı.", nil)
			return
		}
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Yazma izni gerekli.", nil)
		return
	}

	_, err = h.Service.DB.Exec(ctx, `
		DELETE FROM item_annotations WHERE item_id = $1 AND key = $2
	`, itemID, key)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Annotation silinemedi.", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
