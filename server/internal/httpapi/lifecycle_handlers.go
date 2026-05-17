package httpapi

// Lifecycle stage endpoints — DevOps yaşam döngüsü aşamaları (PR-F5c).
//
// GET  /api/v1/lifecycle-stages           — sabit katalog listesi
// GET  /api/v1/items/{id}/lifecycle-stages — item'ın atanmış stage'leri
// POST /api/v1/items/{id}/lifecycle-stages — item'a stage ata (upsert)

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/auth"
)

// LifecycleHandlers groups lifecycle-stage endpoints.
type LifecycleHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

// lifecycleStage is the JSON representation of a catalog entry.
type lifecycleStage struct {
	ID        int16  `json:"id"`
	Key       string `json:"key"`
	Label     string `json:"label"`
	SortOrder int16  `json:"sort_order"`
	Color     string `json:"color"`
}

// listStagesResponse is the GET /lifecycle-stages response.
type listStagesResponse struct {
	Stages []lifecycleStage `json:"stages"`
}

// ListStages implements GET /api/v1/lifecycle-stages.
// Returns the fixed catalog of DevOps lifecycle stages.
func (h *LifecycleHandlers) ListStages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	rows, err := h.Service.DB.Query(ctx, `
		SELECT id, key, label, sort_order, color
		FROM lifecycle_stages
		ORDER BY sort_order
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası", err)
		return
	}
	defer rows.Close()

	stages := make([]lifecycleStage, 0, 8)
	for rows.Next() {
		var s lifecycleStage
		if err := rows.Scan(&s.ID, &s.Key, &s.Label, &s.SortOrder, &s.Color); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veri okunamadı", err)
			return
		}
		stages = append(stages, s)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veri okunamadı", rows.Err())
		return
	}

	writeJSON(w, http.StatusOK, listStagesResponse{Stages: stages})
}

// itemLifecycleStagesResponse is the GET /items/{id}/lifecycle-stages response.
type itemLifecycleStagesResponse struct {
	StageIDs []int16 `json:"stage_ids"`
}

// GetItemStages implements GET /api/v1/items/{id}/lifecycle-stages.
// Returns the lifecycle stage IDs assigned to a specific item.
func (h *LifecycleHandlers) GetItemStages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli", nil)
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz item ID", nil)
		return
	}

	// Permission check: user must be able to at least read the item.
	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız", err)
		return
	}
	if !perm.AllowsRead() {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı", nil)
		return
	}

	rows, err := h.Service.DB.Query(ctx, `
		SELECT lifecycle_stage_id
		FROM item_lifecycle_stages
		WHERE item_id = $1
		ORDER BY lifecycle_stage_id
	`, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası", err)
		return
	}
	defer rows.Close()

	stageIDs := make([]int16, 0, 4)
	for rows.Next() {
		var id int16
		if err := rows.Scan(&id); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veri okunamadı", err)
			return
		}
		stageIDs = append(stageIDs, id)
	}

	writeJSON(w, http.StatusOK, itemLifecycleStagesResponse{StageIDs: stageIDs})
}

// setItemStagesRequest is the POST /items/{id}/lifecycle-stages body.
type setItemStagesRequest struct {
	StageIDs []int16 `json:"stage_ids"`
}

// SetItemStages implements POST /api/v1/items/{id}/lifecycle-stages.
// Replaces the item's lifecycle stage assignments (upsert semantics).
// Requires write permission on the item.
func (h *LifecycleHandlers) SetItemStages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli", nil)
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz item ID", nil)
		return
	}

	var req setItemStagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçersiz JSON", err)
		return
	}

	// Validate stage_ids: max 8 stages, each 1-8 range.
	if len(req.StageIDs) > 8 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
			"En fazla 8 stage atanabilir", nil)
		return
	}
	for _, sid := range req.StageIDs {
		if sid < 1 || sid > 8 {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation,
				"Stage ID 1-8 arasında olmalı", nil)
			return
		}
	}

	// Permission check: write required.
	perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İzin kontrolü başarısız", err)
		return
	}
	if !perm.AllowsWrite() {
		if perm == auth.ItemPermNone {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Item bulunamadı", nil)
			return
		}
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Yazma izni gerekli", nil)
		return
	}

	// Transaction: delete existing + insert new.
	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem başlatılamadı", err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	_, err = tx.Exec(ctx, `DELETE FROM item_lifecycle_stages WHERE item_id = $1`, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası", err)
		return
	}

	if len(req.StageIDs) > 0 {
		for _, sid := range req.StageIDs {
			_, err = tx.Exec(ctx, `
				INSERT INTO item_lifecycle_stages (item_id, lifecycle_stage_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
			`, itemID, sid)
			if err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Veritabanı hatası", err)
				return
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı", err)
		return
	}

	writeJSON(w, http.StatusOK, itemLifecycleStagesResponse(req))
}
