package httpapi

// PR-K8S: HTML inventory report generation endpoint.
//
// POST /api/v1/admin/reports/generate
//
// Security:
//   - Admin-only (enforced by RequireRole middleware in router).
//   - K8s live API responses are fetched, rendered, and discarded — never stored.
//   - Audit entry includes item count and options; no K8s payload or field values.
//   - At most 50 items per request; goroutine pool capped at 5 parallel.

import (
	"bytes"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/k8s"
)

//go:embed report.html.tmpl
var reportTmplRaw string

var reportTmpl = template.Must(
	template.New("report").Funcs(template.FuncMap{
		"formatTime":    reportFormatTime,
		"severityClass": reportSeverityClass,
		"metricPercent": reportMetricPercent,
		"add":           func(a, b int) int { return a + b },
	}).Parse(reportTmplRaw),
)

// ReportHandlers groups HTML report generation endpoints.
type ReportHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// reportGenerateRequest is the body for POST /api/v1/admin/reports/generate.
type reportGenerateRequest struct {
	ItemIDs []string      `json:"item_ids"`
	Options reportOptions `json:"options"`
}

// reportOptions controls what is included in the generated report.
type reportOptions struct {
	IncludeK8sLive       bool   `json:"include_k8s_live"`
	IncludeRelationships bool   `json:"include_relationships"`
	IncludeFieldValues   bool   `json:"include_field_values"`
	ReportTitle          string `json:"report_title"`
}

// ─── Report data model ────────────────────────────────────────────────────────

type reportItem struct {
	ID          string
	Name        string
	ItemType    string
	FolderPath  string
	Description string
	Tags        []string
	ExpiresAt   *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time

	// Relationships (when IncludeRelationships=true)
	RelatedItems []reportRelationship

	// Live K8s data (when item has a k8s binding + IncludeK8sLive=true)
	K8sData *reportK8sData
}

type reportRelationship struct {
	TargetID   string
	TargetName string
	RelType    string
}

type reportK8sData struct {
	Namespace   string
	ClusterName string
	Pods        []k8s.Pod
	Deployments []k8s.Deployment
	Services    []k8s.Service
	Events      []k8s.Event // Warning events only, capped at 20
	Metrics     []k8s.PodMetrics
	FetchError  string
}

type reportTemplateData struct {
	Title       string
	GeneratedAt string
	ItemCount   int
	Options     reportOptions
	Items       []reportItem
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// Generate implements POST /api/v1/admin/reports/generate.
func (h *ReportHandlers) Generate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)

	var req reportGenerateRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if len(req.ItemIDs) == 0 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item_ids boş olamaz.", errors.New("empty item_ids"))
		return
	}
	if len(req.ItemIDs) > 50 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Tek seferde en fazla 50 item raporu üretilebilir.", errors.New("too many items"))
		return
	}
	if req.Options.ReportTitle == "" {
		req.Options.ReportTitle = "IronStock Envanter Raporu"
	}

	// 1. Load item metadata + decrypt names server-side.
	itemRows, err := h.loadItems(ctx, req.ItemIDs)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item verileri yüklenemedi.", err)
		return
	}

	// 2. Load single-hop relationship graph.
	if req.Options.IncludeRelationships {
		if err := h.loadRelationships(ctx, itemRows); err != nil {
			h.Logger.Warn("report: relationship load partial error", slog.String("error", err.Error()))
		}
	}

	// 3. Fetch live K8s data (bounded pool, max 5 goroutines).
	if req.Options.IncludeK8sLive {
		h.fetchAllK8s(ctx, itemRows)
	}

	// 4. Render self-contained HTML.
	data := reportTemplateData{
		Title:       req.Options.ReportTitle,
		GeneratedAt: time.Now().UTC().Format("2006-01-02 15:04:05 UTC"),
		ItemCount:   len(itemRows),
		Options:     req.Options,
		Items:       itemRows,
	}
	var buf bytes.Buffer
	if err := reportTmpl.Execute(&buf, data); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Rapor şablonu işlenemedi.", err)
		return
	}

	// 5. Audit — no payload or field values.
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminReportGenerated,
		Details: map[string]any{
			"item_count":            len(itemRows),
			"include_k8s_live":      req.Options.IncludeK8sLive,
			"include_relationships": req.Options.IncludeRelationships,
			"include_field_values":  req.Options.IncludeFieldValues,
		},
	})

	// 6. Stream HTML response with Content-Disposition: attachment.
	filename := fmt.Sprintf("ironstock-report-%s.html", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	w.WriteHeader(http.StatusOK)
	_, _ = buf.WriteTo(w)
}

// ─── loadItems ────────────────────────────────────────────────────────────────

func (h *ReportHandlers) loadItems(ctx context.Context, itemIDs []string) ([]reportItem, error) {
	args := make([]any, len(itemIDs))
	placeholders := make([]string, len(itemIDs))
	for i, id := range itemIDs {
		args[i] = id
		placeholders[i] = fmt.Sprintf("$%d::uuid", i+1)
	}
	inClause := strings.Join(placeholders, ",")

	rows, err := h.Service.DB.Query(ctx, fmt.Sprintf(`
		SELECT
		    i.id::text,
		    COALESCE(it.label, ''),
		    COALESCE(f.name, ''),
		    COALESCE(i.description, ''),
		    i.name_enc, i.server_dek_wrapped,
		    i.expires_at,
		    i.created_at, i.updated_at,
		    COALESCE(
		        array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL),
		        '{}'::text[]
		    )
		FROM items i
		LEFT JOIN item_types it   ON it.id = i.item_type_id
		LEFT JOIN folders f       ON f.id  = i.folder_id
		LEFT JOIN item_tags itag  ON itag.item_id = i.id
		LEFT JOIN tags t          ON t.id = itag.tag_id
		WHERE i.id IN (%s)
		GROUP BY i.id, it.label, f.name
		ORDER BY i.created_at
	`, inClause), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []reportItem
	for rows.Next() {
		var (
			item       reportItem
			nameEnc    []byte
			dekWrapped []byte
			expiresAt  *time.Time
		)
		if err := rows.Scan(
			&item.ID, &item.ItemType, &item.FolderPath, &item.Description,
			&nameEnc, &dekWrapped, &expiresAt,
			&item.CreatedAt, &item.UpdatedAt, &item.Tags,
		); err != nil {
			return nil, err
		}
		item.ExpiresAt = expiresAt
		if item.Tags == nil {
			item.Tags = []string{}
		}
		name, err := decryptItemName(h.Service, item.ID, dekWrapped, nameEnc)
		if err != nil {
			h.Logger.Warn("report: name decrypt failed", slog.String("item_id", item.ID))
			name = "(şifreli)"
		}
		item.Name = name
		out = append(out, item)
	}
	return out, rows.Err()
}

// ─── loadRelationships ────────────────────────────────────────────────────────

func (h *ReportHandlers) loadRelationships(ctx context.Context, items []reportItem) error {
	if len(items) == 0 {
		return nil
	}
	nameMap := make(map[string]string, len(items))
	for _, it := range items {
		nameMap[it.ID] = it.Name
	}

	args := make([]any, len(items))
	placeholders := make([]string, len(items))
	for i, it := range items {
		args[i] = it.ID
		placeholders[i] = fmt.Sprintf("$%d::uuid", i+1)
	}

	rows, err := h.Service.DB.Query(ctx, fmt.Sprintf(`
		SELECT
		    r.source_item_id::text,
		    r.target_item_id::text,
		    COALESCE(t.name_plain, ''),
		    r.relationship_type
		FROM item_relationships r
		LEFT JOIN items t ON t.id = r.target_item_id
		WHERE r.source_item_id IN (%s)
		ORDER BY r.source_item_id, r.relationship_type
	`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	relMap := make(map[string][]reportRelationship)
	for rows.Next() {
		var sourceID, targetID, targetName, relType string
		if err := rows.Scan(&sourceID, &targetID, &targetName, &relType); err != nil {
			continue
		}
		if n, ok := nameMap[targetID]; ok && n != "" {
			targetName = n
		}
		relMap[sourceID] = append(relMap[sourceID], reportRelationship{
			TargetID:   targetID,
			TargetName: targetName,
			RelType:    relType,
		})
	}
	for i := range items {
		items[i].RelatedItems = relMap[items[i].ID]
	}
	return rows.Err()
}

// ─── fetchAllK8s ──────────────────────────────────────────────────────────────

// fetchAllK8s fans out K8s fetches for all items using a bounded goroutine pool.
func (h *ReportHandlers) fetchAllK8s(ctx context.Context, items []reportItem) {
	type job struct{ idx int }
	jobs := make(chan job, len(items))
	for i := range items {
		jobs <- job{idx: i}
	}
	close(jobs)

	var mu sync.Mutex
	var wg sync.WaitGroup
	const poolSize = 5
	for w := 0; w < poolSize; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				data := h.fetchItemK8s(ctx, items[j.idx].ID)
				if data != nil {
					mu.Lock()
					items[j.idx].K8sData = data
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
}

// fetchItemK8s fetches all K8s resources for one item.
// Returns nil if the item has no K8s binding.
func (h *ReportHandlers) fetchItemK8s(ctx context.Context, itemID string) *reportK8sData {
	var clusterID, namespaceName, clusterName string
	err := h.Service.DB.QueryRow(ctx, `
		SELECT b.cluster_id::text, b.namespace_name, COALESCE(c.name, '')
		FROM item_k8s_bindings b
		LEFT JOIN k8s_clusters c ON c.id = b.cluster_id
		WHERE b.item_id=$1::uuid
	`, itemID).Scan(&clusterID, &namespaceName, &clusterName)
	if err != nil {
		return nil // no binding
	}

	data := &reportK8sData{
		Namespace:   namespaceName,
		ClusterName: clusterName,
	}

	cfg, err := decryptClusterConfig(ctx, h.Service, clusterID)
	if err != nil {
		data.FetchError = "Cluster yapılandırması okunamadı: " + err.Error()
		return data
	}
	client, err := k8s.New(*cfg)
	if err != nil {
		data.FetchError = "K8s client oluşturulamadı: " + err.Error()
		return data
	}

	type fetchResult struct {
		key   string
		value any
		err   error
	}
	ch := make(chan fetchResult, 5)

	go func() { v, e := client.ListPods(ctx, namespaceName); ch <- fetchResult{"pods", v, e} }()
	go func() { v, e := client.ListDeployments(ctx, namespaceName); ch <- fetchResult{"deps", v, e} }()
	go func() { v, e := client.ListServices(ctx, namespaceName); ch <- fetchResult{"svcs", v, e} }()
	go func() { v, e := client.ListEvents(ctx, namespaceName); ch <- fetchResult{"evts", v, e} }()
	go func() { v, e := client.ListPodMetrics(ctx, namespaceName); ch <- fetchResult{"mets", v, e} }()

	var firstErr error
	for i := 0; i < 5; i++ {
		r := <-ch
		if r.err != nil {
			if firstErr == nil {
				firstErr = r.err
			}
			continue
		}
		switch r.key {
		case "pods":
			data.Pods = r.value.(*k8s.PodList).Items
		case "deps":
			data.Deployments = r.value.(*k8s.DeploymentList).Items
		case "svcs":
			data.Services = r.value.(*k8s.ServiceList).Items
		case "evts":
			for _, e := range r.value.(*k8s.EventList).Items {
				if e.Type == "Warning" && len(data.Events) < 20 {
					data.Events = append(data.Events, e)
				}
			}
		case "mets":
			data.Metrics = r.value.(*k8s.PodMetricsList).Items
		}
	}
	if firstErr != nil && len(data.Pods) == 0 && len(data.Deployments) == 0 {
		data.FetchError = firstErr.Error()
	}
	return data
}

// ─── Template helpers ─────────────────────────────────────────────────────────

func reportFormatTime(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.UTC().Format("2006-01-02 15:04")
}

func reportSeverityClass(eventType string) string {
	if eventType == "Warning" {
		return "warning"
	}
	return "normal"
}

// reportMetricPercent converts a Kubernetes quantity string to an integer 0-100.
// CPU: 1000m = 100%. Memory: 1024Mi = 100%, 1Gi = 100%.
func reportMetricPercent(quantity string) int {
	if quantity == "" {
		return 0
	}
	clamp := func(n int) int {
		if n > 100 {
			return 100
		}
		if n < 0 {
			return 0
		}
		return n
	}
	q := quantity
	if strings.HasSuffix(q, "m") {
		n, err := strconv.Atoi(q[:len(q)-1])
		if err != nil {
			return 0
		}
		return clamp(n / 10) // 1000m = 100%
	}
	if strings.HasSuffix(q, "Mi") {
		n, err := strconv.Atoi(q[:len(q)-2])
		if err != nil {
			return 0
		}
		return clamp(n * 100 / 1024) // 1024Mi = 100%
	}
	if strings.HasSuffix(q, "Gi") {
		n, err := strconv.Atoi(q[:len(q)-2])
		if err != nil {
			return 0
		}
		return clamp(n * 100) // 1Gi = 100%
	}
	return 0
}
