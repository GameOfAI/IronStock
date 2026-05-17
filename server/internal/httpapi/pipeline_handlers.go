package httpapi

// Pipeline diagram endpoints — named saved graph views (PR-F5d).
//
// GET    /api/v1/pipeline-diagrams              — list user's diagrams
// POST   /api/v1/pipeline-diagrams              — create diagram
// GET    /api/v1/pipeline-diagrams/{id}         — get single diagram (meta + nodes)
// PUT    /api/v1/pipeline-diagrams/{id}         — update name/description
// DELETE /api/v1/pipeline-diagrams/{id}         — delete diagram
// POST   /api/v1/pipeline-diagrams/{id}/nodes   — add items to diagram
// DELETE /api/v1/pipeline-diagrams/{id}/nodes/{item_id} — remove item from diagram
// PUT    /api/v1/pipeline-diagrams/{id}/layout  — save node positions + viewport
// GET    /api/v1/pipeline-diagrams/{id}/graph   — filtered graph (nodes + edges)

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/auth"
)

// PipelineHandlers groups pipeline diagram endpoints.
type PipelineHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

// ── types ────────────────────────────────────────────────────────────────────

type pipelineDiagramMeta struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	FolderID    *string         `json:"folder_id,omitempty"`
	LayoutData  json.RawMessage `json:"layout_data"`
	CreatedBy   string          `json:"created_by"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type pipelineDiagramNode struct {
	ItemID      string   `json:"item_id"`
	PositionX   *float64 `json:"position_x,omitempty"`
	PositionY   *float64 `json:"position_y,omitempty"`
	CustomLabel *string  `json:"custom_label,omitempty"`
}

type pipelineDiagramDetail struct {
	pipelineDiagramMeta
	Nodes []pipelineDiagramNode `json:"nodes"`
}

type createPipelineDiagramRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	FolderID    *string `json:"folder_id,omitempty"`
}

type updatePipelineDiagramRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type addNodesRequest struct {
	ItemIDs []string `json:"item_ids"`
}

type layoutNodePosition struct {
	ItemID    string   `json:"item_id"`
	PositionX *float64 `json:"position_x"`
	PositionY *float64 `json:"position_y"`
}

type saveLayoutRequest struct {
	Nodes    []layoutNodePosition `json:"nodes"`
	Viewport json.RawMessage      `json:"viewport,omitempty"`
}

// ── helpers ──────────────────────────────────────────────────────────────────

// ownerOrAdmin checks that the claims user is diagram owner or admin.
func (h *PipelineHandlers) ownerOrAdmin(claims *auth.Claims, ownerID string) bool {
	if claims.Subject == ownerID {
		return true
	}
	for _, r := range claims.Roles {
		if r == "admin" {
			return true
		}
	}
	return false
}

// ── list ─────────────────────────────────────────────────────────────────────

// ListDiagrams implements GET /api/v1/pipeline-diagrams.
func (h *PipelineHandlers) ListDiagrams(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	rows, err := h.Service.DB.Query(ctx, `
		SELECT id, name, description, folder_id, layout_data, created_by, created_at, updated_at
		FROM pipeline_diagrams
		WHERE created_by = $1
		ORDER BY updated_at DESC
	`, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	defer rows.Close()

	diagrams := make([]pipelineDiagramMeta, 0, 16)
	for rows.Next() {
		var d pipelineDiagramMeta
		if err := rows.Scan(&d.ID, &d.Name, &d.Description, &d.FolderID,
			&d.LayoutData, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veri okunamadı", err)
			return
		}
		diagrams = append(diagrams, d)
	}

	writeJSON(w, http.StatusOK, map[string]any{"diagrams": diagrams})
}

// ── create ───────────────────────────────────────────────────────────────────

// CreateDiagram implements POST /api/v1/pipeline-diagrams.
func (h *PipelineHandlers) CreateDiagram(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	var req createPipelineDiagramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON", err)
		return
	}
	if req.Name == "" || len(req.Name) > 256 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation, "İsim 1-256 karakter olmalı", nil)
		return
	}

	var d pipelineDiagramMeta
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO pipeline_diagrams (name, description, folder_id, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, description, folder_id, layout_data, created_by, created_at, updated_at
	`, req.Name, req.Description, req.FolderID, claims.Subject).Scan(
		&d.ID, &d.Name, &d.Description, &d.FolderID,
		&d.LayoutData, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Oluşturulamadı", err)
		return
	}

	writeJSON(w, http.StatusCreated, d)
}

// ── get ──────────────────────────────────────────────────────────────────────

// GetDiagram implements GET /api/v1/pipeline-diagrams/{id}.
func (h *PipelineHandlers) GetDiagram(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	var d pipelineDiagramMeta
	err := h.Service.DB.QueryRow(ctx, `
		SELECT id, name, description, folder_id, layout_data, created_by, created_at, updated_at
		FROM pipeline_diagrams WHERE id = $1
	`, diagramID).Scan(&d.ID, &d.Name, &d.Description, &d.FolderID,
		&d.LayoutData, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}

	if !h.ownerOrAdmin(claims, d.CreatedBy) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	// Fetch nodes.
	rows, err := h.Service.DB.Query(ctx, `
		SELECT item_id, position_x, position_y, custom_label
		FROM pipeline_diagram_nodes WHERE diagram_id = $1
	`, diagramID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	defer rows.Close()

	nodes := make([]pipelineDiagramNode, 0, 32)
	for rows.Next() {
		var n pipelineDiagramNode
		if err := rows.Scan(&n.ItemID, &n.PositionX, &n.PositionY, &n.CustomLabel); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veri okunamadı", err)
			return
		}
		nodes = append(nodes, n)
	}

	writeJSON(w, http.StatusOK, pipelineDiagramDetail{
		pipelineDiagramMeta: d,
		Nodes:               nodes,
	})
}

// ── update ───────────────────────────────────────────────────────────────────

// UpdateDiagram implements PUT /api/v1/pipeline-diagrams/{id}.
func (h *PipelineHandlers) UpdateDiagram(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	// Check ownership.
	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	var req updatePipelineDiagramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON", err)
		return
	}

	// Build dynamic update.
	if req.Name != nil && (len(*req.Name) == 0 || len(*req.Name) > 256) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation, "İsim 1-256 karakter olmalı", nil)
		return
	}

	_, err = h.Service.DB.Exec(ctx, `
		UPDATE pipeline_diagrams
		SET name = COALESCE($2, name),
		    description = COALESCE($3, description),
		    updated_at = now()
		WHERE id = $1
	`, diagramID, req.Name, req.Description)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Güncellenemedi", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── delete ───────────────────────────────────────────────────────────────────

// DeleteDiagram implements DELETE /api/v1/pipeline-diagrams/{id}.
func (h *PipelineHandlers) DeleteDiagram(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	_, err = h.Service.DB.Exec(ctx, `DELETE FROM pipeline_diagrams WHERE id = $1`, diagramID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Silinemedi", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── nodes: add ───────────────────────────────────────────────────────────────

// AddNodes implements POST /api/v1/pipeline-diagrams/{id}/nodes.
func (h *PipelineHandlers) AddNodes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	// Verify ownership.
	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	var req addNodesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON", err)
		return
	}
	if len(req.ItemIDs) == 0 || len(req.ItemIDs) > 100 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeValidation, "1-100 arası item eklenebilir", nil)
		return
	}

	for _, id := range req.ItemIDs {
		_, err := h.Service.DB.Exec(ctx, `
			INSERT INTO pipeline_diagram_nodes (diagram_id, item_id)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, diagramID, id)
		if err != nil {
			h.Logger.Warn("add node failed", "diagram_id", diagramID, "item_id", id, "err", err)
			// Skip FK violations (item doesn't exist), continue with rest.
			continue
		}
	}

	// Update diagram timestamp.
	_, _ = h.Service.DB.Exec(ctx, `UPDATE pipeline_diagrams SET updated_at = now() WHERE id = $1`, diagramID)

	w.WriteHeader(http.StatusNoContent)
}

// ── nodes: remove ────────────────────────────────────────────────────────────

// RemoveNode implements DELETE /api/v1/pipeline-diagrams/{id}/nodes/{item_id}.
func (h *PipelineHandlers) RemoveNode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "item_id")

	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	_, err = h.Service.DB.Exec(ctx, `
		DELETE FROM pipeline_diagram_nodes WHERE diagram_id = $1 AND item_id = $2
	`, diagramID, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Silinemedi", err)
		return
	}

	_, _ = h.Service.DB.Exec(ctx, `UPDATE pipeline_diagrams SET updated_at = now() WHERE id = $1`, diagramID)
	w.WriteHeader(http.StatusNoContent)
}

// ── layout ───────────────────────────────────────────────────────────────────

// SaveLayout implements PUT /api/v1/pipeline-diagrams/{id}/layout.
func (h *PipelineHandlers) SaveLayout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	var req saveLayoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Geçersiz JSON", err)
		return
	}

	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "İşlem başlatılamadı", err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Update node positions.
	for _, n := range req.Nodes {
		_, err := tx.Exec(ctx, `
			UPDATE pipeline_diagram_nodes
			SET position_x = $3, position_y = $4
			WHERE diagram_id = $1 AND item_id = $2
		`, diagramID, n.ItemID, n.PositionX, n.PositionY)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Pozisyon kaydedilemedi", err)
			return
		}
	}

	// Save viewport in layout_data.
	if req.Viewport != nil {
		layoutData, _ := json.Marshal(map[string]json.RawMessage{"viewport": req.Viewport})
		_, err = tx.Exec(ctx, `
			UPDATE pipeline_diagrams SET layout_data = $2, updated_at = now() WHERE id = $1
		`, diagramID, layoutData)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Layout kaydedilemedi", err)
			return
		}
	} else {
		_, _ = tx.Exec(ctx, `UPDATE pipeline_diagrams SET updated_at = now() WHERE id = $1`, diagramID)
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "İşlem tamamlanamadı", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── graph (filtered) ─────────────────────────────────────────────────────────

// DiagramGraph implements GET /api/v1/pipeline-diagrams/{id}/graph.
// Returns graph nodes + edges filtered to only the items in this diagram.
func (h *PipelineHandlers) DiagramGraph(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli", nil)
		return
	}

	diagramID := chi.URLParam(r, "id")

	var ownerID string
	err := h.Service.DB.QueryRow(ctx, `SELECT created_by FROM pipeline_diagrams WHERE id = $1`, diagramID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	if !h.ownerOrAdmin(claims, ownerID) {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Diyagram bulunamadı", nil)
		return
	}

	// Get the nodes in this diagram: items + their lifecycle stages + positions.
	rows, err := h.Service.DB.Query(ctx, `
		SELECT
			pdn.item_id,
			pdn.position_x,
			pdn.position_y,
			pdn.custom_label,
			i.folder_id,
			i.item_type_id,
			i.name_enc,
			i.name_nonce,
			i.server_dek_wrapped,
			i.master_key_id
		FROM pipeline_diagram_nodes pdn
		JOIN items i ON i.id = pdn.item_id
		WHERE pdn.diagram_id = $1
	`, diagramID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	defer rows.Close()

	type diagramGraphNode struct {
		ID               string   `json:"id"`
		FolderID         string   `json:"folder_id"`
		ItemTypeID       int16    `json:"item_type_id"`
		NameEnc          []byte   `json:"name_enc"`
		NameNonce        []byte   `json:"name_nonce"`
		ServerDEKWrapped []byte   `json:"server_dek_wrapped"`
		MasterKeyID      int16    `json:"master_key_id"`
		PositionX        *float64 `json:"position_x,omitempty"`
		PositionY        *float64 `json:"position_y,omitempty"`
		CustomLabel      *string  `json:"custom_label,omitempty"`
	}

	nodeIDs := make(map[string]struct{}, 32)
	nodes := make([]diagramGraphNode, 0, 32)
	for rows.Next() {
		var n diagramGraphNode
		if err := rows.Scan(
			&n.ID, &n.PositionX, &n.PositionY, &n.CustomLabel,
			&n.FolderID, &n.ItemTypeID, &n.NameEnc, &n.NameNonce,
			&n.ServerDEKWrapped, &n.MasterKeyID,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veri okunamadı", err)
			return
		}
		nodeIDs[n.ID] = struct{}{}
		nodes = append(nodes, n)
	}

	// Get edges between these nodes.
	erows, err := h.Service.DB.Query(ctx, `
		SELECT source_item_id, target_item_id, relationship_type, metadata
		FROM item_relationships
		WHERE source_item_id = ANY(
			SELECT item_id FROM pipeline_diagram_nodes WHERE diagram_id = $1
		)
		AND target_item_id = ANY(
			SELECT item_id FROM pipeline_diagram_nodes WHERE diagram_id = $1
		)
	`, diagramID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	defer erows.Close()

	type diagramGraphEdge struct {
		SourceID string          `json:"source_id"`
		TargetID string          `json:"target_id"`
		Type     string          `json:"type"`
		Metadata json.RawMessage `json:"metadata,omitempty"`
	}

	edges := make([]diagramGraphEdge, 0, 32)
	for erows.Next() {
		var e diagramGraphEdge
		if err := erows.Scan(&e.SourceID, &e.TargetID, &e.Type, &e.Metadata); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veri okunamadı", err)
			return
		}
		edges = append(edges, e)
	}

	// Get lifecycle stages for all nodes.
	lrows, err := h.Service.DB.Query(ctx, `
		SELECT ils.item_id, ils.lifecycle_stage_id
		FROM item_lifecycle_stages ils
		WHERE ils.item_id = ANY(
			SELECT item_id FROM pipeline_diagram_nodes WHERE diagram_id = $1
		)
	`, diagramID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası", err)
		return
	}
	defer lrows.Close()

	lifecycleMap := make(map[string][]int16, 32)
	for lrows.Next() {
		var itemID string
		var stageID int16
		if err := lrows.Scan(&itemID, &stageID); err != nil {
			continue
		}
		lifecycleMap[itemID] = append(lifecycleMap[itemID], stageID)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"nodes":            nodes,
		"edges":            edges,
		"lifecycle_stages": lifecycleMap,
	})
}
