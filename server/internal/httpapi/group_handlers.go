package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// GroupHandlers manages user groups and folder-group permission grants.
// All routes are admin-only (RequireRole(RoleAdmin) in router).
type GroupHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// --- DTOs ---

type groupRow struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	CreatedBy   string  `json:"created_by"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	MemberCount int     `json:"member_count"`
}

type groupListResponse struct {
	Groups []groupRow `json:"groups"`
	Total  int        `json:"total"`
}

type groupMemberRow struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	AddedBy   string `json:"added_by,omitempty"`
	AddedAt   string `json:"added_at"`
}

// --- Group CRUD ---

// ListGroups implements GET /api/v1/admin/groups.
func (h *GroupHandlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var total int
	if err := h.Service.DB.QueryRow(ctx, `SELECT count(*) FROM groups`).Scan(&total); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Gruplar sayılamadı.", err)
		return
	}

	const sqlText = `
		SELECT
		    g.id::text,
		    g.name,
		    COALESCE(g.description, ''),
		    g.created_by::text,
		    g.created_at::text,
		    g.updated_at::text,
		    count(gm.user_id)::int AS member_count
		FROM groups g
		LEFT JOIN group_members gm ON gm.group_id = g.id
		GROUP BY g.id
		ORDER BY g.name
	`
	rows, err := h.Service.DB.Query(ctx, sqlText)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]groupRow, 0)
	for rows.Next() {
		var g groupRow
		var desc string
		if err := rows.Scan(
			&g.ID, &g.Name, &desc, &g.CreatedBy,
			&g.CreatedAt, &g.UpdatedAt, &g.MemberCount,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Grup satırı okunamadı.", err)
			return
		}
		if desc != "" {
			g.Description = &desc
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup listesi okunamadı.", err)
		return
	}
	writeJSON(w, http.StatusOK, groupListResponse{Groups: out, Total: total})
}

// CreateGroup implements POST /api/v1/admin/groups.
func (h *GroupHandlers) CreateGroup(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if len(req.Name) < 2 || len(req.Name) > 128 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Grup adı 2-128 karakter olmalı.", errors.New("bad name length"))
		return
	}

	ctx := r.Context()
	var g groupRow
	var desc string
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO groups (name, description, created_by)
		VALUES ($1, NULLIF($2,''), $3::uuid)
		RETURNING id::text, name, COALESCE(description,''), created_by::text, created_at::text, updated_at::text
	`, req.Name, req.Description, claims.Subject,
	).Scan(&g.ID, &g.Name, &desc, &g.CreatedBy, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu isimde bir grup zaten var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup oluşturulamadı.", err)
		return
	}
	if desc != "" {
		g.Description = &desc
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionGroupCreated,
		ResourceType: audit.ResourceGroup,
		ResourceID:   g.ID,
		Details:      map[string]any{"name": g.Name},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, g)
}

// GetGroup implements GET /api/v1/admin/groups/{id}.
func (h *GroupHandlers) GetGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	var g groupRow
	var desc string
	err := h.Service.DB.QueryRow(ctx, `
		SELECT
		    g.id::text, g.name, COALESCE(g.description,''), g.created_by::text,
		    g.created_at::text, g.updated_at::text,
		    count(gm.user_id)::int
		FROM groups g
		LEFT JOIN group_members gm ON gm.group_id = g.id
		WHERE g.id = $1::uuid
		GROUP BY g.id
	`, id).Scan(&g.ID, &g.Name, &desc, &g.CreatedBy, &g.CreatedAt, &g.UpdatedAt, &g.MemberCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Grup bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup okunamadı.", err)
		return
	}
	if desc != "" {
		g.Description = &desc
	}
	writeJSON(w, http.StatusOK, g)
}

// DeleteGroup implements DELETE /api/v1/admin/groups/{id}.
func (h *GroupHandlers) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	tag, err := h.Service.DB.Exec(ctx, `DELETE FROM groups WHERE id = $1::uuid`, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Already gone — idempotent.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionGroupDeleted,
		ResourceType: audit.ResourceGroup,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// --- Group Members ---

// ListGroupMembers implements GET /api/v1/admin/groups/{id}/members.
func (h *GroupHandlers) ListGroupMembers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	const sqlText = `
		SELECT gm.user_id::text, u.username, COALESCE(gm.added_by::text,''), gm.added_at::text
		FROM group_members gm
		JOIN users u ON u.id = gm.user_id
		WHERE gm.group_id = $1::uuid
		ORDER BY u.username
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Grup üyeleri alınamadı.", err)
		return
	}
	defer rows.Close()

	out := make([]groupMemberRow, 0)
	for rows.Next() {
		var m groupMemberRow
		if err := rows.Scan(&m.UserID, &m.Username, &m.AddedBy, &m.AddedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Üye satırı okunamadı.", err)
			return
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Üye listesi okunamadı.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

// AddGroupMember implements POST /api/v1/admin/groups/{id}/members.
func (h *GroupHandlers) AddGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	groupID := chi.URLParam(r, "id")

	var req struct {
		UserID string `json:"user_id"`
	}
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"user_id zorunlu.", errors.New("missing user_id"))
		return
	}

	ctx := r.Context()
	_, err := h.Service.DB.Exec(ctx, `
		INSERT INTO group_members (group_id, user_id, added_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (group_id, user_id) DO NOTHING
	`, groupID, req.UserID, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Üye eklenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionGroupMemberAdded,
		ResourceType: audit.ResourceGroup,
		ResourceID:   groupID,
		Details:      map[string]any{"user_id": req.UserID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// RemoveGroupMember implements DELETE /api/v1/admin/groups/{id}/members/{user_id}.
func (h *GroupHandlers) RemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	groupID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "user_id")

	ctx := r.Context()
	_, err := h.Service.DB.Exec(ctx, `
		DELETE FROM group_members WHERE group_id = $1::uuid AND user_id = $2::uuid
	`, groupID, userID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Üye çıkarılamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionGroupMemberRemoved,
		ResourceType: audit.ResourceGroup,
		ResourceID:   groupID,
		Details:      map[string]any{"user_id": userID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// --- Folder-Group Permissions ---

// GrantFolderGroupPermission implements POST /api/v1/admin/groups/{id}/folder-permissions.
// Body: { folder_id, permission: "read"|"write", inherit_to_children: bool }
func (h *GroupHandlers) GrantFolderGroupPermission(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	groupID := chi.URLParam(r, "id")

	var req struct {
		FolderID           string `json:"folder_id"`
		Permission         string `json:"permission"`
		InheritToChildren  bool   `json:"inherit_to_children"`
	}
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.FolderID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"folder_id zorunlu.", errors.New("missing folder_id"))
		return
	}
	if req.Permission != "read" && req.Permission != "write" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"permission 'read' veya 'write' olmalı.", errors.New("bad permission"))
		return
	}

	ctx := r.Context()
	_, err := h.Service.DB.Exec(ctx, `
		INSERT INTO folder_group_permissions
		    (folder_id, group_id, permission, inherit_to_children, granted_by)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
		ON CONFLICT (folder_id, group_id) DO UPDATE
		    SET permission = EXCLUDED.permission,
		        inherit_to_children = EXCLUDED.inherit_to_children,
		        granted_by = EXCLUDED.granted_by,
		        granted_at = now(),
		        revoked_at = NULL
	`, req.FolderID, groupID, req.Permission, req.InheritToChildren, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör izni verilemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderPermissionGrant,
		ResourceType: audit.ResourceFolder,
		ResourceID:   req.FolderID,
		Details:      map[string]any{"group_id": groupID, "permission": req.Permission, "inherit": req.InheritToChildren},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// RevokeFolderGroupPermission implements DELETE /api/v1/admin/groups/{id}/folder-permissions/{folder_id}.
func (h *GroupHandlers) RevokeFolderGroupPermission(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	groupID := chi.URLParam(r, "id")
	folderID := chi.URLParam(r, "folder_id")

	ctx := r.Context()
	_, err := h.Service.DB.Exec(ctx, `
		UPDATE folder_group_permissions
		SET revoked_at = now()
		WHERE folder_id = $1::uuid AND group_id = $2::uuid AND revoked_at IS NULL
	`, folderID, groupID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör izni kaldırılamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderPermissionRevoke,
		ResourceType: audit.ResourceFolder,
		ResourceID:   folderID,
		Details:      map[string]any{"group_id": groupID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}
