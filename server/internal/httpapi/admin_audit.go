package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// auditLogEntry is one audit_log row in the API response.
//
// Details is the raw jsonb (kept as RawMessage so the client decides how
// to render — it varies per action).
type auditLogEntry struct {
	ID           int64           `json:"id"`
	ActorUserID  *string         `json:"actor_user_id,omitempty"`
	Action       string          `json:"action"`
	ResourceType *string         `json:"resource_type,omitempty"`
	ResourceID   *string         `json:"resource_id,omitempty"`
	Details      json.RawMessage `json:"details,omitempty"`
	IPAddress    *string         `json:"ip_address,omitempty"`
	UserAgent    *string         `json:"user_agent,omitempty"`
	CreatedAt    string          `json:"created_at"`
}

type auditLogResponse struct {
	Entries []auditLogEntry `json:"entries"`
	Total   int             `json:"total"`
	Limit   int             `json:"limit"`
	Offset  int             `json:"offset"`
}

// QueryAuditLog implements GET /api/v1/admin/audit-log.
//
// Filters (all optional, AND-combined):
//
//	?action=auth.login              exact match
//	?actor_user_id=<uuid>            exact
//	?resource_type=item              CHECK constraint values
//	?resource_id=<uuid>              exact
//	?from=2026-04-01T00:00:00Z       RFC 3339, inclusive
//	?to=2026-04-30T23:59:59Z         RFC 3339, exclusive
//	?limit=100&offset=0              default 50, max 500
//
// Total reflects the filter set, NOT the global row count — so the client
// can paginate accurately.
func (h *AdminHandlers) QueryAuditLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := parseIntDefault(q.Get("limit"), 50, 1, 500)
	offset := parseIntDefault(q.Get("offset"), 0, 0, 1<<24)

	filt, err := buildAuditFilter(q)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Total under filter.
	var total int
	countSQL, countArgs := filt.buildCountSQL()
	if err := h.Service.DB.QueryRow(ctx, countSQL, countArgs...).Scan(&total); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Audit log sayılamadı.", err)
		return
	}

	pageSQL, pageArgs := filt.buildPageSQL(limit, offset)

	var ids []int64
	var actorIDs, actions, resourceTypes, resourceIDs, ips, userAgents, createdAts []string
	var details [][]byte
	if err := h.Service.DB.QueryRow(ctx, pageSQL, pageArgs...).Scan(
		&ids, &actorIDs, &actions, &resourceTypes, &resourceIDs,
		&details, &ips, &userAgents, &createdAts,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Audit log okunamadı.", err)
		return
	}

	entries := make([]auditLogEntry, 0, len(ids))
	for i := range ids {
		entries = append(entries, auditLogEntry{
			ID:           ids[i],
			ActorUserID:  emptyToNil(actorIDs[i]),
			Action:       actions[i],
			ResourceType: emptyToNil(resourceTypes[i]),
			ResourceID:   emptyToNil(resourceIDs[i]),
			Details:      json.RawMessage(details[i]),
			IPAddress:    emptyToNil(ips[i]),
			UserAgent:    emptyToNil(userAgents[i]),
			CreatedAt:    createdAts[i],
		})
	}

	writeJSON(w, http.StatusOK, auditLogResponse{
		Entries: entries,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
	})
}

// auditFilter builds the WHERE clause from query string params.
type auditFilter struct {
	action       string
	actorUserID  string
	resourceType string
	resourceID   string
	from         *time.Time
	to           *time.Time
}

func buildAuditFilter(q map[string][]string) (auditFilter, error) {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return strings.TrimSpace(v[0])
		}
		return ""
	}

	f := auditFilter{
		action:       get("action"),
		actorUserID:  get("actor_user_id"),
		resourceType: get("resource_type"),
		resourceID:   get("resource_id"),
	}
	if rt := f.resourceType; rt != "" && !validResourceType(rt) {
		return auditFilter{}, errors.New("resource_type geçersiz")
	}
	if s := get("from"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return auditFilter{}, errors.New("from parametresi RFC3339 olmalı")
		}
		f.from = &t
	}
	if s := get("to"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return auditFilter{}, errors.New("to parametresi RFC3339 olmalı")
		}
		f.to = &t
	}
	if f.from != nil && f.to != nil && f.to.Before(*f.from) {
		return auditFilter{}, errors.New("to parametresi from'dan önce olamaz")
	}
	return f, nil
}

// validResourceType mirrors the CHECK in 00005_audit_log.sql.
func validResourceType(rt string) bool {
	switch rt {
	case "user", "session", "role", "folder", "item", "item_share", "master_key", "system":
		return true
	}
	return false
}

// buildCountSQL returns "SELECT count(*) FROM audit_log WHERE ..." matching
// the filter set. Args are positional placeholders.
func (f auditFilter) buildCountSQL() (string, []any) {
	where, args := f.whereClause()
	return "SELECT count(*) FROM audit_log " + where, args
}

// buildPageSQL returns the page SELECT with array_agg projection.
//
// Pagination placeholders ($N+1 LIMIT, $N+2 OFFSET) are appended after the
// WHERE args so positional indices stay stable.
func (f auditFilter) buildPageSQL(limit, offset int) (string, []any) {
	where, args := f.whereClause()
	args = append(args, limit, offset)
	limitArg := "$" + strconv.Itoa(len(args)-1)
	offsetArg := "$" + strconv.Itoa(len(args))

	q := `
		SELECT
		    COALESCE(array_agg(id                                       ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(COALESCE(actor_user_id::text, '')        ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(action                                   ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(COALESCE(resource_type, '')              ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(COALESCE(resource_id::text, '')          ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(details::text::bytea                     ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(COALESCE(host(ip_address), '')           ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(COALESCE(user_agent, '')                 ORDER BY id DESC), '{}'),
		    COALESCE(array_agg(created_at::text                         ORDER BY id DESC), '{}')
		FROM (
		    SELECT * FROM audit_log
		    ` + where + `
		    ORDER BY id DESC
		    LIMIT ` + limitArg + ` OFFSET ` + offsetArg + `
		) page
	`
	return q, args
}

// whereClause builds "WHERE c1 AND c2 ..." with $1, $2, ... placeholders.
// Returns empty string when no filter is set. Pagination args (LIMIT,
// OFFSET) are appended by the caller AFTER these.
func (f auditFilter) whereClause() (string, []any) {
	conds := make([]string, 0, 6)
	args := make([]any, 0, 6)
	// addCond appends one condition with the next placeholder index.
	addCond := func(template string, val any) {
		pos := len(args) + 1
		conds = append(conds, strings.ReplaceAll(template, "?", "$"+strconv.Itoa(pos)))
		args = append(args, val)
	}
	if f.action != "" {
		addCond("action = ?", f.action)
	}
	if f.actorUserID != "" {
		addCond("actor_user_id = ?::uuid", f.actorUserID)
	}
	if f.resourceType != "" {
		addCond("resource_type = ?", f.resourceType)
	}
	if f.resourceID != "" {
		addCond("resource_id = ?::uuid", f.resourceID)
	}
	if f.from != nil {
		addCond("created_at >= ?", *f.from)
	}
	if f.to != nil {
		addCond("created_at < ?", *f.to)
	}
	if len(conds) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conds, " AND "), args
}

// emptyToNil maps "" to a nil pointer (omitempty serialization). Audit
// projection uses empty strings for NULLs because array_agg can't carry
// nullable text natively.
func emptyToNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
