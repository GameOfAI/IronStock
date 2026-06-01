package httpapi

// scim_handlers.go — PR-SCIM: SCIM 2.0 provisioning endpoints.
//
// Implements the minimal SCIM 2.0 subset required by Azure AD and Okta:
//   - ServiceProviderConfig (capability advertisement)
//   - Users: List, Get, Create, PATCH (update/deactivate), Delete
//   - Groups: List, Get, Create, PATCH (member add/remove)
//
// Auth: Bearer token validated against api_tokens WHERE scope='scim'.
// Endpoint base: /scim/v2/
//
// Protocol refs:
//   - RFC 7643 — SCIM Core Schema
//   - RFC 7644 — SCIM Protocol

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
)

// SCIM schema URNs
const (
	scimSchemaUser         = "urn:ietf:params:scim:schemas:core:2.0:User"
	scimSchemaGroup        = "urn:ietf:params:scim:schemas:core:2.0:Group"
	scimSchemaListResponse = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
	scimSchemaPatchOp      = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
	scimSchemaSpConfig     = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
	scimSchemaError        = "urn:ietf:params:scim:api:messages:2.0:Error"
)

const scimContentType = "application/scim+json"

// SCIMHandlers implements the SCIM 2.0 provisioning API.
type SCIMHandlers struct {
	DB     *pgxpool.Pool
	Audit  *audit.Writer
	Logger *slog.Logger
}

// ---------- SCIM resource types ----------

type scimMeta struct {
	ResourceType string `json:"resourceType"`
	Created      string `json:"created"`
	LastModified string `json:"lastModified"`
	Location     string `json:"location,omitempty"`
}

type scimEmail struct {
	Value   string `json:"value"`
	Type    string `json:"type,omitempty"`
	Primary bool   `json:"primary,omitempty"`
}

type scimUser struct {
	Schemas    []string    `json:"schemas"`
	ID         string      `json:"id"`
	ExternalID string      `json:"externalId,omitempty"`
	UserName   string      `json:"userName"`
	Emails     []scimEmail `json:"emails,omitempty"`
	Active     bool        `json:"active"`
	Meta       scimMeta    `json:"meta"`
}

type scimGroupMember struct {
	Value   string `json:"value"`
	Display string `json:"display,omitempty"`
}

type scimGroup struct {
	Schemas     []string          `json:"schemas"`
	ID          string            `json:"id"`
	ExternalID  string            `json:"externalId,omitempty"`
	DisplayName string            `json:"displayName"`
	Members     []scimGroupMember `json:"members"`
	Meta        scimMeta          `json:"meta"`
}

type scimListResponse struct {
	Schemas      []string    `json:"schemas"`
	TotalResults int         `json:"totalResults"`
	StartIndex   int         `json:"startIndex"`
	ItemsPerPage int         `json:"itemsPerPage"`
	Resources    interface{} `json:"Resources"`
}

type scimPatchOp struct {
	Schemas    []string        `json:"schemas"`
	Operations []scimOperation `json:"Operations"`
}

type scimOperation struct {
	Op    string          `json:"op"` // Add, Remove, Replace
	Path  string          `json:"path,omitempty"`
	Value json.RawMessage `json:"value,omitempty"`
}

type scimErrorResp struct {
	Schemas  []string `json:"schemas"`
	Status   string   `json:"status"`
	ScimType string   `json:"scimType,omitempty"`
	Detail   string   `json:"detail,omitempty"`
}

// ---------- Auth helper ----------

// requireSCIMToken validates the Bearer token against api_tokens WHERE scope='scim'.
// Returns (actorUserID, ok). On failure it writes the SCIM error response.
func (h *SCIMHandlers) requireSCIMToken(w http.ResponseWriter, r *http.Request) (string, bool) {
	authHdr := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHdr, "Bearer ") {
		h.scimError(w, http.StatusUnauthorized, "unauthorized", "Missing Bearer token")
		return "", false
	}
	rawToken := strings.TrimPrefix(authHdr, "Bearer ")
	if rawToken == "" {
		h.scimError(w, http.StatusUnauthorized, "unauthorized", "Empty Bearer token")
		return "", false
	}

	hashBytes := sha256.Sum256([]byte(rawToken))

	ctx := r.Context()
	var userID string
	var scope string
	var expiresAt *time.Time
	err := h.DB.QueryRow(ctx,
		`SELECT user_id::text, scope, expires_at FROM api_tokens WHERE token_hash = $1`,
		hashBytes[:],
	).Scan(&userID, &scope, &expiresAt)
	if err != nil {
		h.scimError(w, http.StatusUnauthorized, "unauthorized", "Invalid API token")
		return "", false
	}
	if scope != "scim" {
		h.scimError(w, http.StatusForbidden, "forbidden", "Token scope not permitted for SCIM")
		return "", false
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		h.scimError(w, http.StatusUnauthorized, "unauthorized", "API token expired")
		return "", false
	}

	// Update last_used_at (best-effort).
	_, _ = h.DB.Exec(ctx,
		`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1`,
		hashBytes[:])

	return userID, true
}

// ---------- Write helpers ----------

func (h *SCIMHandlers) scimJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", scimContentType)
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		h.Logger.Error("scim: json encode error", "err", err)
	}
}

func (h *SCIMHandlers) scimError(w http.ResponseWriter, status int, scimType, detail string) {
	w.Header().Set("Content-Type", scimContentType)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(scimErrorResp{
		Schemas:  []string{scimSchemaError},
		Status:   strconv.Itoa(status),
		ScimType: scimType,
		Detail:   detail,
	})
}

// ---------- ServiceProviderConfig ----------

// GetServiceProviderConfig implements GET /scim/v2/ServiceProviderConfig.
func (h *SCIMHandlers) GetServiceProviderConfig(w http.ResponseWriter, _ *http.Request) {
	cfg := map[string]interface{}{
		"schemas":          []string{scimSchemaSpConfig},
		"documentationUri": "https://docs.ironstock.internal/integrations/scim",
		"patch":            map[string]bool{"supported": true},
		"bulk":             map[string]interface{}{"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
		"filter":           map[string]interface{}{"supported": true, "maxResults": 200},
		"changePassword":   map[string]bool{"supported": false},
		"sort":             map[string]bool{"supported": false},
		"etag":             map[string]bool{"supported": false},
		"authenticationSchemes": []map[string]interface{}{
			{
				"type":        "oauthbearertoken",
				"name":        "OAuth Bearer Token",
				"description": "IronStock API token with SCIM scope",
				"specUri":     "https://tools.ietf.org/html/rfc6750",
				"primary":     true,
			},
		},
		"meta": scimMeta{
			ResourceType: "ServiceProviderConfig",
			Location:     "/scim/v2/ServiceProviderConfig",
		},
	}
	h.scimJSON(w, http.StatusOK, cfg)
}

// ---------- Users ----------

// ListUsers implements GET /scim/v2/Users[?filter=...&count=N&startIndex=N].
func (h *SCIMHandlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireSCIMToken(w, r); !ok {
		return
	}

	q := r.URL.Query()
	count := parseIntDefault(q.Get("count"), 100, 1, 200)
	startIndex := parseIntDefault(q.Get("startIndex"), 1, 1, 1<<20)
	filter := q.Get("filter")

	ctx := r.Context()
	whereSQL, whereArgs := scimParseFilter(filter)
	offset := startIndex - 1
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := h.DB.QueryRow(ctx, `SELECT count(*) FROM users WHERE `+whereSQL, whereArgs...).Scan(&total); err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to count users")
		return
	}

	limitArg := len(whereArgs) + 1
	offsetArg := len(whereArgs) + 2
	listSQL := `SELECT id::text, username, email, status, COALESCE(scim_external_id,''),
		               created_at::text, updated_at::text
		        FROM users WHERE ` + whereSQL +
		` ORDER BY username LIMIT $` + strconv.Itoa(limitArg) + ` OFFSET $` + strconv.Itoa(offsetArg)

	args := make([]interface{}, 0, len(whereArgs)+2)
	args = append(args, whereArgs...)
	args = append(args, count, offset)

	rows, err := h.DB.Query(ctx, listSQL, args...)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to list users")
		return
	}
	defer rows.Close()

	var users []scimUser
	for rows.Next() {
		var id, username, email, status, extID, createdAt, updatedAt string
		if err := rows.Scan(&id, &username, &email, &status, &extID, &createdAt, &updatedAt); err != nil {
			continue
		}
		users = append(users, buildSCIMUser(id, username, email, status, extID, createdAt, updatedAt))
	}
	if users == nil {
		users = []scimUser{}
	}

	h.scimJSON(w, http.StatusOK, scimListResponse{
		Schemas:      []string{scimSchemaListResponse},
		TotalResults: total,
		StartIndex:   startIndex,
		ItemsPerPage: len(users),
		Resources:    users,
	})
}

// GetUser implements GET /scim/v2/Users/{id}.
func (h *SCIMHandlers) GetUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireSCIMToken(w, r); !ok {
		return
	}
	id := chi.URLParam(r, "id")
	u, found, err := h.dbFetchUser(r.Context(), id)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "DB error")
		return
	}
	if !found {
		h.scimError(w, http.StatusNotFound, "notFound", "User not found")
		return
	}
	h.scimJSON(w, http.StatusOK, u)
}

// CreateUser implements POST /scim/v2/Users.
func (h *SCIMHandlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	actorID, ok := h.requireSCIMToken(w, r)
	if !ok {
		return
	}

	var payload struct {
		UserName   string      `json:"userName"`
		ExternalID string      `json:"externalId"`
		Active     *bool       `json:"active"`
		Emails     []scimEmail `json:"emails"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "Invalid JSON body")
		return
	}
	if payload.UserName == "" {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "userName is required")
		return
	}

	email := ""
	for _, e := range payload.Emails {
		if e.Primary || email == "" {
			email = e.Value
		}
	}
	if email == "" {
		email = payload.UserName
	}

	active := true
	if payload.Active != nil {
		active = *payload.Active
	}
	status := "active"
	if !active {
		status = "disabled"
	}

	ctx := r.Context()

	var exists bool
	_ = h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 OR email = $2)`,
		strings.ToLower(payload.UserName), strings.ToLower(email),
	).Scan(&exists)
	if exists {
		h.scimError(w, http.StatusConflict, "uniqueness", "Username or email already exists")
		return
	}

	// Locked password hash: random 32 bytes with a known-invalid prefix.
	// argon2_params includes locked=true so normal login will always fail.
	lockedHash := make([]byte, 32)
	lockedParams, _ := json.Marshal(map[string]interface{}{"t": 3, "m": 65536, "p": 4, "v": 1, "scim_locked": true})

	var newID, createdAt, updatedAt string
	var extIDInsert *string
	if payload.ExternalID != "" {
		extIDInsert = &payload.ExternalID
	}

	err := h.DB.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash, argon2_params, status, scim_external_id)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id::text, created_at::text, updated_at::text`,
		strings.ToLower(payload.UserName),
		strings.ToLower(email),
		lockedHash,
		lockedParams,
		status,
		extIDInsert,
	).Scan(&newID, &createdAt, &updatedAt)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to create user")
		return
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  actorID,
		Action:       "scim.user_provisioned",
		ResourceType: "user",
		ResourceID:   newID,
		Details:      map[string]any{"username": payload.UserName, "external_id": payload.ExternalID},
	})

	h.scimJSON(w, http.StatusCreated,
		buildSCIMUser(newID, payload.UserName, email, status, payload.ExternalID, createdAt, updatedAt))
}

// PatchUser implements PATCH /scim/v2/Users/{id}.
func (h *SCIMHandlers) PatchUser(w http.ResponseWriter, r *http.Request) {
	actorID, ok := h.requireSCIMToken(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var patch scimPatchOp
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "Invalid PATCH body")
		return
	}

	ctx := r.Context()

	u, found, err := h.dbFetchUser(ctx, id)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "DB error")
		return
	}
	if !found {
		h.scimError(w, http.StatusNotFound, "notFound", "User not found")
		return
	}

	for _, op := range patch.Operations {
		opLower := strings.ToLower(op.Op)
		pathLower := strings.ToLower(strings.TrimSpace(op.Path))

		switch {
		case opLower == "replace" && pathLower == "active":
			h.applyActiveOp(ctx, id, u.UserName, actorID, op.Value)

		case opLower == "replace" && pathLower == "username":
			var newUsername string
			if json.Unmarshal(op.Value, &newUsername) == nil && newUsername != "" {
				_, _ = h.DB.Exec(ctx,
					`UPDATE users SET username = $1, updated_at = now() WHERE id = $2`,
					strings.ToLower(newUsername), id)
			}

		case opLower == "replace" && pathLower == "externalid":
			var extID string
			if json.Unmarshal(op.Value, &extID) == nil {
				_, _ = h.DB.Exec(ctx,
					`UPDATE users SET scim_external_id = $1, updated_at = now() WHERE id = $2`,
					extID, id)
			}

		case opLower == "replace" && pathLower == "":
			// Azure AD bulk replace — value is an object with field keys.
			var fields map[string]json.RawMessage
			if json.Unmarshal(op.Value, &fields) == nil {
				if rawActive, ok2 := fields["active"]; ok2 {
					h.applyActiveOp(ctx, id, u.UserName, actorID, rawActive)
				}
			}
		}
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  actorID,
		Action:       "scim.user_updated",
		ResourceType: "user",
		ResourceID:   id,
		Details:      map[string]any{"username": u.UserName},
	})

	updated, _, _ := h.dbFetchUser(ctx, id)
	h.scimJSON(w, http.StatusOK, updated)
}

// applyActiveOp toggles user active/disabled state.
func (h *SCIMHandlers) applyActiveOp(ctx context.Context, userID, username, actorID string, raw json.RawMessage) {
	var active bool
	if json.Unmarshal(raw, &active) != nil {
		return
	}
	newStatus := "active"
	if !active {
		newStatus = "disabled"
	}
	_, _ = h.DB.Exec(ctx,
		`UPDATE users SET status = $1, updated_at = now() WHERE id = $2`,
		newStatus, userID)
	if !active {
		_, _ = h.DB.Exec(ctx, `UPDATE sessions SET revoked_at = now(), revoke_reason = 'scim_deprovisioned' WHERE user_id = $1 AND revoked_at IS NULL`, userID)
		h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
			ActorUserID:  actorID,
			Action:       "scim.user_deprovisioned",
			ResourceType: "user",
			ResourceID:   userID,
			Details:      map[string]any{"username": username},
		})
	}
}

// DeleteUser implements DELETE /scim/v2/Users/{id}.
// Soft-deactivates and revokes sessions. Does NOT hard-delete.
func (h *SCIMHandlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	actorID, ok := h.requireSCIMToken(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	var username string
	err := h.DB.QueryRow(ctx,
		`UPDATE users SET status = 'disabled', updated_at = now()
		 WHERE id = $1 RETURNING username`,
		id,
	).Scan(&username)
	if err != nil {
		var exists bool
		_ = h.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, id).Scan(&exists)
		if !exists {
			h.scimError(w, http.StatusNotFound, "notFound", "User not found")
			return
		}
		// Already disabled — idempotent success.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_, _ = h.DB.Exec(ctx, `UPDATE sessions SET revoked_at = now(), revoke_reason = 'scim_deprovisioned' WHERE user_id = $1 AND revoked_at IS NULL`, id)

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  actorID,
		Action:       "scim.user_deprovisioned",
		ResourceType: "user",
		ResourceID:   id,
		Details:      map[string]any{"username": username, "method": "DELETE"},
	})

	w.WriteHeader(http.StatusNoContent)
}

// ---------- Groups ----------

// ListGroups implements GET /scim/v2/Groups.
func (h *SCIMHandlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireSCIMToken(w, r); !ok {
		return
	}

	q := r.URL.Query()
	count := parseIntDefault(q.Get("count"), 100, 1, 200)
	startIndex := parseIntDefault(q.Get("startIndex"), 1, 1, 1<<20)
	offset := startIndex - 1
	if offset < 0 {
		offset = 0
	}

	ctx := r.Context()

	var total int
	if err := h.DB.QueryRow(ctx, `SELECT count(*) FROM groups`).Scan(&total); err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to count groups")
		return
	}

	rows, err := h.DB.Query(ctx,
		`SELECT id::text, name, created_at::text, updated_at::text
		 FROM groups ORDER BY name LIMIT $1 OFFSET $2`,
		count, offset,
	)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to list groups")
		return
	}
	defer rows.Close()

	var groups []scimGroup
	for rows.Next() {
		var id, name, createdAt, updatedAt string
		if err := rows.Scan(&id, &name, &createdAt, &updatedAt); err != nil {
			continue
		}
		g := scimGroup{
			Schemas:     []string{scimSchemaGroup},
			ID:          id,
			DisplayName: name,
			Members:     h.dbFetchGroupMembers(ctx, id),
			Meta: scimMeta{
				ResourceType: "Group",
				Created:      createdAt,
				LastModified: updatedAt,
				Location:     "/scim/v2/Groups/" + id,
			},
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []scimGroup{}
	}

	h.scimJSON(w, http.StatusOK, scimListResponse{
		Schemas:      []string{scimSchemaListResponse},
		TotalResults: total,
		StartIndex:   startIndex,
		ItemsPerPage: len(groups),
		Resources:    groups,
	})
}

// GetGroup implements GET /scim/v2/Groups/{id}.
func (h *SCIMHandlers) GetGroup(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireSCIMToken(w, r); !ok {
		return
	}
	id := chi.URLParam(r, "id")
	g, found, err := h.dbFetchGroup(r.Context(), id)
	if err != nil {
		h.scimError(w, http.StatusInternalServerError, "internalError", "DB error")
		return
	}
	if !found {
		h.scimError(w, http.StatusNotFound, "notFound", "Group not found")
		return
	}
	h.scimJSON(w, http.StatusOK, g)
}

// CreateGroup implements POST /scim/v2/Groups.
func (h *SCIMHandlers) CreateGroup(w http.ResponseWriter, r *http.Request) {
	actorID, ok := h.requireSCIMToken(w, r)
	if !ok {
		return
	}

	var payload struct {
		DisplayName string            `json:"displayName"`
		ExternalID  string            `json:"externalId"`
		Members     []scimGroupMember `json:"members"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "Invalid JSON body")
		return
	}
	if payload.DisplayName == "" {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "displayName is required")
		return
	}

	ctx := r.Context()

	var newID, createdAt, updatedAt string
	err := h.DB.QueryRow(ctx,
		`INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id::text, created_at::text, updated_at::text`,
		payload.DisplayName, actorID,
	).Scan(&newID, &createdAt, &updatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			h.scimError(w, http.StatusConflict, "uniqueness", "Group name already exists")
			return
		}
		h.scimError(w, http.StatusInternalServerError, "internalError", "Failed to create group")
		return
	}

	for _, m := range payload.Members {
		_, _ = h.DB.Exec(ctx,
			`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			newID, m.Value,
		)
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  actorID,
		Action:       "scim.group_synced",
		ResourceType: "group",
		ResourceID:   newID,
		Details:      map[string]any{"display_name": payload.DisplayName, "op": "create"},
	})

	h.scimJSON(w, http.StatusCreated, scimGroup{
		Schemas:     []string{scimSchemaGroup},
		ID:          newID,
		ExternalID:  payload.ExternalID,
		DisplayName: payload.DisplayName,
		Members:     h.dbFetchGroupMembers(ctx, newID),
		Meta: scimMeta{
			ResourceType: "Group",
			Created:      createdAt,
			LastModified: updatedAt,
			Location:     "/scim/v2/Groups/" + newID,
		},
	})
}

// PatchGroup implements PATCH /scim/v2/Groups/{id}.
func (h *SCIMHandlers) PatchGroup(w http.ResponseWriter, r *http.Request) {
	actorID, ok := h.requireSCIMToken(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var patch scimPatchOp
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		h.scimError(w, http.StatusBadRequest, "invalidValue", "Invalid PATCH body")
		return
	}

	ctx := r.Context()

	g, found, err := h.dbFetchGroup(ctx, id)
	if err != nil || !found {
		h.scimError(w, http.StatusNotFound, "notFound", "Group not found")
		return
	}

	for _, op := range patch.Operations {
		opLower := strings.ToLower(op.Op)
		pathLower := strings.ToLower(strings.TrimSpace(op.Path))

		switch {
		case opLower == "add" && strings.HasPrefix(pathLower, "members"):
			var members []scimGroupMember
			if json.Unmarshal(op.Value, &members) == nil {
				for _, m := range members {
					_, _ = h.DB.Exec(ctx,
						`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
						id, m.Value)
				}
			}

		case opLower == "remove" && strings.HasPrefix(pathLower, "members"):
			if op.Value != nil {
				// value = [{value: uuid}] or {value: uuid}
				var members []scimGroupMember
				if json.Unmarshal(op.Value, &members) == nil {
					for _, m := range members {
						_, _ = h.DB.Exec(ctx,
							`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
							id, m.Value)
					}
				} else {
					var single scimGroupMember
					if json.Unmarshal(op.Value, &single) == nil && single.Value != "" {
						_, _ = h.DB.Exec(ctx,
							`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
							id, single.Value)
					}
				}
			} else if strings.Contains(pathLower, "value eq") {
				userID := scimExtractValueEq(op.Path)
				if userID != "" {
					_, _ = h.DB.Exec(ctx,
						`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
						id, userID)
				}
			}

		case opLower == "replace" && pathLower == "displayname":
			var name string
			if json.Unmarshal(op.Value, &name) == nil && name != "" {
				_, _ = h.DB.Exec(ctx,
					`UPDATE groups SET name = $1, updated_at = now() WHERE id = $2`,
					name, id)
			}
		}
	}

	h.Audit.Write(ctx, audit.Entry{ //nolint:errcheck
		ActorUserID:  actorID,
		Action:       "scim.group_synced",
		ResourceType: "group",
		ResourceID:   id,
		Details:      map[string]any{"display_name": g.DisplayName, "op": "patch"},
	})

	updated, _, _ := h.dbFetchGroup(ctx, id)
	h.scimJSON(w, http.StatusOK, updated)
}

// ---------- DB helpers ----------

func (h *SCIMHandlers) dbFetchUser(ctx context.Context, id string) (scimUser, bool, error) {
	var uid, username, email, status, extID, createdAt, updatedAt string
	err := h.DB.QueryRow(ctx,
		`SELECT id::text, username, email, status, COALESCE(scim_external_id,''),
		        created_at::text, updated_at::text
		 FROM users WHERE id = $1`, id,
	).Scan(&uid, &username, &email, &status, &extID, &createdAt, &updatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return scimUser{}, false, nil
		}
		return scimUser{}, false, err
	}
	return buildSCIMUser(uid, username, email, status, extID, createdAt, updatedAt), true, nil
}

func (h *SCIMHandlers) dbFetchGroup(ctx context.Context, id string) (scimGroup, bool, error) {
	var gid, name, createdAt, updatedAt string
	err := h.DB.QueryRow(ctx,
		`SELECT id::text, name, created_at::text, updated_at::text FROM groups WHERE id = $1`, id,
	).Scan(&gid, &name, &createdAt, &updatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return scimGroup{}, false, nil
		}
		return scimGroup{}, false, err
	}
	return scimGroup{
		Schemas:     []string{scimSchemaGroup},
		ID:          gid,
		DisplayName: name,
		Members:     h.dbFetchGroupMembers(ctx, gid),
		Meta: scimMeta{
			ResourceType: "Group",
			Created:      createdAt,
			LastModified: updatedAt,
			Location:     "/scim/v2/Groups/" + gid,
		},
	}, true, nil
}

func (h *SCIMHandlers) dbFetchGroupMembers(ctx context.Context, groupID string) []scimGroupMember {
	rows, err := h.DB.Query(ctx,
		`SELECT gm.user_id::text, u.username
		 FROM group_members gm
		 JOIN users u ON u.id = gm.user_id
		 WHERE gm.group_id = $1`,
		groupID,
	)
	if err != nil {
		return []scimGroupMember{}
	}
	defer rows.Close()

	var members []scimGroupMember
	for rows.Next() {
		var m scimGroupMember
		if err := rows.Scan(&m.Value, &m.Display); err == nil {
			members = append(members, m)
		}
	}
	if members == nil {
		return []scimGroupMember{}
	}
	return members
}

// ---------- Pure helpers ----------

func buildSCIMUser(id, username, email, status, extID, createdAt, updatedAt string) scimUser {
	active := status == "active" || status == "pending_totp"
	u := scimUser{
		Schemas:  []string{scimSchemaUser},
		ID:       id,
		UserName: username,
		Active:   active,
		Emails:   []scimEmail{{Value: email, Type: "work", Primary: true}},
		Meta: scimMeta{
			ResourceType: "User",
			Created:      createdAt,
			LastModified: updatedAt,
			Location:     "/scim/v2/Users/" + id,
		},
	}
	if extID != "" {
		u.ExternalID = extID
	}
	return u
}

// scimParseFilter parses a simple SCIM filter into SQL WHERE + args.
// Supported: userName eq "...", externalId eq "...", id eq "..."
func scimParseFilter(filter string) (string, []interface{}) {
	if filter == "" {
		return "true", nil
	}
	lower := strings.ToLower(filter)

	switch {
	case strings.HasPrefix(lower, "username eq "):
		return "lower(username) = lower($1)", []interface{}{scimExtractFilterValue(filter)}
	case strings.HasPrefix(lower, "externalid eq "):
		return "scim_external_id = $1", []interface{}{scimExtractFilterValue(filter)}
	case strings.HasPrefix(lower, "id eq "):
		return "id::text = $1", []interface{}{scimExtractFilterValue(filter)}
	}
	return "true", nil
}

func scimExtractFilterValue(filter string) string {
	idx := strings.IndexAny(filter, "\"'")
	if idx < 0 {
		return ""
	}
	rest := filter[idx+1:]
	end := strings.IndexAny(rest, "\"'")
	if end < 0 {
		return strings.TrimSpace(rest)
	}
	return rest[:end]
}

// scimExtractValueEq extracts UUID from "members[value eq \"uuid\"]"
func scimExtractValueEq(path string) string {
	lower := strings.ToLower(path)
	idx := strings.Index(lower, "eq ")
	if idx < 0 {
		return ""
	}
	rest := path[idx+3:]
	rest = strings.TrimSpace(rest)
	// Strip outer ] first, then strip quote chars.
	rest = strings.TrimRight(rest, "] ")
	rest = strings.Trim(rest, "\"'")
	return strings.TrimSpace(rest)
}
