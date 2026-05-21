package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/logfwd"
)

// LogForwardingHandlers handles CRUD for log_forwarding_configs (PR-LOG1).
// Admin-only; routes are mounted under /api/v1/admin/log-forwarding.
type LogForwardingHandlers struct {
	DB      *pgxpool.Pool
	Audit   *audit.Writer
	Manager *logfwd.Manager
	Logger  *slog.Logger
}

type logForwardingRow struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	TargetType string          `json:"target_type"`
	Enabled    bool            `json:"enabled"`
	Config     json.RawMessage `json:"config"`
	CreatedAt  string          `json:"created_at"`
	UpdatedAt  string          `json:"updated_at"`
	CreatedBy  string          `json:"created_by"`
}

type createLogForwardingRequest struct {
	Name       string          `json:"name"`
	TargetType string          `json:"target_type"`
	Enabled    bool            `json:"enabled"`
	Config     json.RawMessage `json:"config"`
}

type updateLogForwardingRequest struct {
	Name    *string          `json:"name,omitempty"`
	Enabled *bool            `json:"enabled,omitempty"`
	Config  *json.RawMessage `json:"config,omitempty"`
}

// ListConfigs implements GET /api/v1/admin/log-forwarding.
func (h *LogForwardingHandlers) ListConfigs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.DB.Query(ctx, `
		SELECT id::text, name, target_type, enabled, config,
		       created_at::text, updated_at::text, created_by::text
		FROM log_forwarding_configs
		ORDER BY created_at ASC
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "query failed", err)
		return
	}
	defer rows.Close()

	configs := make([]logForwardingRow, 0)
	for rows.Next() {
		var row logForwardingRow
		if err := rows.Scan(
			&row.ID, &row.Name, &row.TargetType, &row.Enabled, &row.Config,
			&row.CreatedAt, &row.UpdatedAt, &row.CreatedBy,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "scan failed", err)
			return
		}
		configs = append(configs, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"configs": configs})
}

// CreateConfig implements POST /api/v1/admin/log-forwarding.
func (h *LogForwardingHandlers) CreateConfig(w http.ResponseWriter, r *http.Request) {
	var req createLogForwardingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "invalid JSON", err)
		return
	}
	if req.Name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "name is required", nil)
		return
	}
	if req.TargetType != "syslog" && req.TargetType != "slack" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "target_type must be syslog or slack", nil)
		return
	}
	if len(req.Config) == 0 {
		req.Config = json.RawMessage(`{}`)
	}

	// Validate config by attempting to build a forwarder.
	// BuildForwarder dials the target for syslog; we only parse config here.
	if _, err := logfwd.ParseConfig(req.TargetType, req.Config); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	claims := ClaimsFromContext(r.Context())
	ctx := r.Context()

	var row logForwardingRow
	err := h.DB.QueryRow(ctx, `
		INSERT INTO log_forwarding_configs (name, target_type, enabled, config, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text, name, target_type, enabled, config,
		          created_at::text, updated_at::text, created_by::text
	`, req.Name, req.TargetType, req.Enabled, req.Config, claims.Subject).Scan(
		&row.ID, &row.Name, &row.TargetType, &row.Enabled, &row.Config,
		&row.CreatedAt, &row.UpdatedAt, &row.CreatedBy,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "insert failed", err)
		return
	}

	// If enabled, register with the manager.
	if row.Enabled {
		h.startForwarder(row.ID, row.TargetType, row.Config)
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminLogForwardingCreated,
		ResourceType: "log_forwarding_config",
		ResourceID:   row.ID,
		Details:      map[string]any{"name": row.Name, "target_type": row.TargetType},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, row)
}

// UpdateConfig implements PUT /api/v1/admin/log-forwarding/{id}.
func (h *LogForwardingHandlers) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateLogForwardingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "invalid JSON", err)
		return
	}

	// Fetch existing row.
	ctx := r.Context()
	var existing logForwardingRow
	err := h.DB.QueryRow(ctx, `
		SELECT id::text, name, target_type, enabled, config,
		       created_at::text, updated_at::text, created_by::text
		FROM log_forwarding_configs WHERE id = $1
	`, id).Scan(
		&existing.ID, &existing.Name, &existing.TargetType, &existing.Enabled, &existing.Config,
		&existing.CreatedAt, &existing.UpdatedAt, &existing.CreatedBy,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "config not found", err)
		return
	}

	// Patch fields.
	newName := existing.Name
	newEnabled := existing.Enabled
	newConfig := existing.Config

	if req.Name != nil {
		newName = *req.Name
	}
	if req.Enabled != nil {
		newEnabled = *req.Enabled
	}
	if req.Config != nil {
		newConfig = *req.Config
		// Re-validate config.
		if _, err := logfwd.ParseConfig(existing.TargetType, newConfig); err != nil {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
			return
		}
	}

	var row logForwardingRow
	err = h.DB.QueryRow(ctx, `
		UPDATE log_forwarding_configs
		SET name=$2, enabled=$3, config=$4, updated_at=NOW()
		WHERE id=$1
		RETURNING id::text, name, target_type, enabled, config,
		          created_at::text, updated_at::text, created_by::text
	`, id, newName, newEnabled, newConfig).Scan(
		&row.ID, &row.Name, &row.TargetType, &row.Enabled, &row.Config,
		&row.CreatedAt, &row.UpdatedAt, &row.CreatedBy,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "update failed", err)
		return
	}

	// Sync manager: remove old forwarder (if any), re-add if enabled.
	h.Manager.Remove(id)
	if row.Enabled {
		h.startForwarder(row.ID, row.TargetType, row.Config)
	}

	claims := ClaimsFromContext(r.Context())
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminLogForwardingUpdated,
		ResourceType: "log_forwarding_config",
		ResourceID:   row.ID,
		Details:      map[string]any{"name": row.Name, "enabled": row.Enabled},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, row)
}

// DeleteConfig implements DELETE /api/v1/admin/log-forwarding/{id}.
func (h *LogForwardingHandlers) DeleteConfig(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	tag, err := h.DB.Exec(ctx, `DELETE FROM log_forwarding_configs WHERE id = $1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "config not found", err)
		return
	}

	// Stop the forwarder goroutine.
	h.Manager.Remove(id)

	claims := ClaimsFromContext(r.Context())
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminLogForwardingDeleted,
		ResourceType: "log_forwarding_config",
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// TestConfig implements POST /api/v1/admin/log-forwarding/{id}/test.
// Sends a synthetic test event to verify connectivity.
func (h *LogForwardingHandlers) TestConfig(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	var targetType string
	var config json.RawMessage
	err := h.DB.QueryRow(ctx, `
		SELECT target_type, config FROM log_forwarding_configs WHERE id = $1
	`, id).Scan(&targetType, &config)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "config not found", err)
		return
	}

	f, err := logfwd.BuildForwarder(id, targetType, config)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "build failed: "+err.Error(), err)
		return
	}
	if f == nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "unknown target type", nil)
		return
	}
	defer f.Close() //nolint:errcheck

	testEvent := logfwd.TestEvent()
	if err := f.Send(ctx, testEvent); err != nil {
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal, "test send failed: "+err.Error(), err)
		return
	}

	claims := ClaimsFromContext(r.Context())
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminLogForwardingTested,
		ResourceType: "log_forwarding_config",
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// startForwarder builds and registers a forwarder with the manager.
// Logs a warning if the forwarder cannot be built (e.g., syslog host unreachable).
func (h *LogForwardingHandlers) startForwarder(id, targetType string, config json.RawMessage) {
	f, err := logfwd.BuildForwarder(id, targetType, config)
	if err != nil {
		h.Logger.Warn("logfwd: failed to build forwarder", "id", id, "type", targetType, "err", err)
		return
	}
	if f == nil {
		return
	}
	h.Manager.Add(f)
}
