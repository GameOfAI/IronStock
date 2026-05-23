package httpapi

// item_health.go — PR-HEALTH: Item health score endpoints.
//
// GET /api/v1/items/{id}/health
//   Returns score (0-100), severity, and per-rule breakdown for one item.
//
// GET /api/v1/items/health-report?threshold=70&limit=50
//   Returns items whose cached health_score < threshold (admin-only).
//   Scores are updated by the background expiry scanner; the endpoint reads
//   the cached column for fast response without re-computation.
//
// Security:
//   - Both endpoints require a valid access token.
//   - /health-report is admin-only.
//   - Field values are never read (E2E encrypted) — only metadata columns.

import (
	"errors"
	"net/http"
	"time"

	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/health"
	"github.com/go-chi/chi/v5"
)

// ItemHealthResponse is returned by GET /api/v1/items/{id}/health.
type ItemHealthResponse struct {
	ItemID    string             `json:"item_id"`
	Score     int                `json:"score"`
	Severity  string             `json:"severity"`
	Breakdown []health.Breakdown `json:"breakdown"`
}

// HealthReportResponse is returned by GET /api/v1/items/health-report.
type HealthReportResponse struct {
	Threshold int                `json:"threshold"`
	Count     int                `json:"count"`
	Items     []HealthReportItem `json:"items"`
}

// HealthReportItem is a row in the health report.
type HealthReportItem struct {
	ItemID      string `json:"item_id"`
	Name        string `json:"name"`
	FolderID    string `json:"folder_id"`
	HealthScore int    `json:"health_score"`
	Severity    string `json:"severity"`
}

// GetHealth implements GET /api/v1/items/{id}/health.
func (h *ItemHandlers) GetHealth(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	itemID := chi.URLParam(r, "id")
	ctx := r.Context()

	// Fetch item metadata columns needed for scoring.
	// Only non-secret metadata columns are read; field values are never accessed.
	const q = `
		SELECT
			i.expires_at,
			i.last_rotated_at,
			i.rotation_interval_days,
			coalesce(i.description, ''),
			i.folder_id::text,
			(SELECT COUNT(*) > 0 FROM item_tags it WHERE it.item_id = i.id) AS has_tags,
			(SELECT COUNT(*)   FROM item_relationships ir
			 WHERE ir.source_item_id = i.id OR ir.target_item_id = i.id) AS rel_count,
			(SELECT COUNT(*) > 0 FROM item_k8s_bindings kb WHERE kb.item_id = i.id) AS k8s_bound
		FROM items i
		WHERE i.id::text = $1
	`
	row := h.Service.DB.QueryRow(ctx, q, itemID)

	var (
		expiresAt     *time.Time
		lastRotatedAt *time.Time
		rotInterval   *int
		description   string
		folderID      string
		hasTags       bool
		relCount      int
		k8sBound      bool
	)
	if err := row.Scan(
		&expiresAt, &lastRotatedAt, &rotInterval,
		&description, &folderID,
		&hasTags, &relCount, &k8sBound,
	); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı.", err)
		return
	}

	// Permission check — non-admins must be able to read the folder.
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, folderID)
		if err != nil || perm == "" {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item'a erişim yetkiniz yok.", err)
			return
		}
	}

	meta := health.ItemMeta{
		ID:                   itemID,
		ExpiresAt:            expiresAt,
		LastRotatedAt:        lastRotatedAt,
		RotationIntervalDays: rotInterval,
		Description:          description,
		HasTags:              hasTags,
		RelationshipCount:    relCount,
		K8sBindingExists:     k8sBound,
		// K8sClusterReachable: not determinable without polling the cluster here;
		// the background scanner sets this via a separate check.
		K8sClusterReachable: true,
	}

	score, breakdown := health.ScoreWithBreakdown(meta, time.Now())
	severity := health.Severity(score)

	// Best-effort cache update (fire-and-forget, non-blocking).
	go func() {
		_, _ = h.Service.DB.Exec(ctx,
			`UPDATE items SET health_score = $1 WHERE id::text = $2`,
			score, itemID,
		)
	}()

	writeJSON(w, http.StatusOK, ItemHealthResponse{
		ItemID:    itemID,
		Score:     score,
		Severity:  severity,
		Breakdown: breakdown,
	})
}

// GetHealthReport implements GET /api/v1/items/health-report (admin-only).
func (h *ItemHandlers) GetHealthReport(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	if !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
			"Yalnızca admin erişebilir.", errors.New("admin required"))
		return
	}

	threshold := parseIntDefault(r.URL.Query().Get("threshold"), 70, 0, 100)
	limit := parseIntDefault(r.URL.Query().Get("limit"), 50, 1, 200)
	ctx := r.Context()

	rows, err := h.Service.DB.Query(ctx, `
		SELECT i.id::text, coalesce(i.name_plain, ''), i.folder_id::text, i.health_score
		FROM items i
		WHERE i.health_score IS NOT NULL AND i.health_score < $1
		ORDER BY i.health_score ASC, coalesce(i.name_plain, '') ASC
		LIMIT $2
	`, threshold, limit)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Health raporu alınamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]HealthReportItem, 0, 16)
	for rows.Next() {
		var item HealthReportItem
		var score int
		if err := rows.Scan(&item.ItemID, &item.Name, &item.FolderID, &score); err != nil {
			continue
		}
		item.HealthScore = score
		item.Severity = health.Severity(score)
		out = append(out, item)
	}

	writeJSON(w, http.StatusOK, HealthReportResponse{
		Threshold: threshold,
		Count:     len(out),
		Items:     out,
	})
}
