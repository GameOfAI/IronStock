package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// AdminHandlers groups admin-only endpoints (/api/v1/admin/*).
//
// All routes here require RoleAdmin (enforced by RequireRole middleware
// in the router). The handler-level checks are extra defense-in-depth.
type AdminHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

type adminUserRow struct {
	ID          string   `json:"id"`
	Username    string   `json:"username"`
	Email       string   `json:"email"`
	Status      string   `json:"status"`
	Roles       []string `json:"roles"`
	LastLoginAt *string  `json:"last_login_at,omitempty"`
	CreatedAt   string   `json:"created_at"`
}

type adminUsersResponse struct {
	Users  []adminUserRow `json:"users"`
	Total  int            `json:"total"`
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}

// ListUsers implements GET /api/v1/admin/users[?limit=&offset=].
//
// Default limit 50, max 200. Includes role names per user (array_agg).
func (h *AdminHandlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit := parseIntDefault(r.URL.Query().Get("limit"), 50, 1, 200)
	offset := parseIntDefault(r.URL.Query().Get("offset"), 0, 0, 1<<20)

	ctx := r.Context()

	// Total count (for pagination UI).
	var total int
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT count(*) FROM users`,
	).Scan(&total); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcılar sayılamadı.", err)
		return
	}

	// Page query.
	const sqlText = `
		SELECT
		    COALESCE(array_agg(id::text                        ORDER BY username), '{}'),
		    COALESCE(array_agg(username                        ORDER BY username), '{}'),
		    COALESCE(array_agg(email                           ORDER BY username), '{}'),
		    COALESCE(array_agg(status                          ORDER BY username), '{}'),
		    COALESCE(array_agg(last_login_at::text             ORDER BY username), '{}'),
		    COALESCE(array_agg(created_at::text                ORDER BY username), '{}')
		FROM (
		    SELECT id, username, email, status, last_login_at, created_at
		    FROM users
		    ORDER BY username
		    LIMIT $1 OFFSET $2
		) page
	`
	var ids, usernames, emails, statuses, lastLogins, createdAts []string
	if err := h.Service.DB.QueryRow(ctx, sqlText, limit, offset).Scan(
		&ids, &usernames, &emails, &statuses, &lastLogins, &createdAts,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı listesi alınamadı.", err)
		return
	}

	out := make([]adminUserRow, 0, len(ids))
	for i := range ids {
		// Per-row roles fetch (small N — the page is at most 200 users).
		// Could be a single CTE but the SQL gets ugly fast.
		roles, err := fetchUserRoles(ctx, h.Service.DB, ids[i])
		if err != nil {
			h.Logger.Warn("user roles fetch failed",
				slog.String("user_id", ids[i]),
				slog.String("error", err.Error()),
			)
			roles = []string{}
		}
		var lastLogin *string
		if lastLogins[i] != "" {
			ll := lastLogins[i]
			lastLogin = &ll
		}
		out = append(out, adminUserRow{
			ID:          ids[i],
			Username:    usernames[i],
			Email:       emails[i],
			Status:      statuses[i],
			Roles:       roles,
			LastLoginAt: lastLogin,
			CreatedAt:   createdAts[i],
		})
	}

	writeJSON(w, http.StatusOK, adminUsersResponse{
		Users:  out,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	})
}

// DisableUser implements POST /api/v1/admin/users/{id}/disable.
//
// Sets users.status = 'disabled' AND revokes all active sessions
// (RevokeAllUserSessions reason='admin'). Idempotent.
//
// Self-disable engeli: admin kendi hesabını kilitleyemez (UX guard, çift
// admin kuralı yok ama fail-safe).
func (h *AdminHandlers) DisableUser(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}
	if id == claims.Subject {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kendi hesabınızı devre dışı bırakamazsınız.",
			errors.New("self-disable"))
		return
	}

	ctx := r.Context()

	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx,
		`UPDATE users SET status = 'disabled' WHERE id = $1::uuid AND status <> 'disabled'`,
		id,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı devre dışı bırakılamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// User missing OR already disabled — idempotent 204.
		_ = tx.Rollback(ctx)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if err := auth.RevokeAllUserSessions(ctx, tx, id, auth.RevokeReasonAdmin); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturumlar revoke edilemedi.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminUserDisabled,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// EnableUser implements POST /api/v1/admin/users/{id}/enable.
//
// Sets status to 'active' (or 'pending_totp' if TOTP not yet verified).
// Does NOT auto-unlock account lockout — separate concern.
func (h *AdminHandlers) EnableUser(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()

	// Re-derive status: if user has a verified TOTP, status='active', else
	// 'pending_totp'. Avoids "active without TOTP" inconsistency.
	const updateSQL = `
		UPDATE users SET status = CASE
		    WHEN EXISTS (
		        SELECT 1 FROM totp_secrets ts
		        WHERE ts.user_id = users.id AND ts.verified = true
		    ) THEN 'active'
		    ELSE 'pending_totp'
		END
		WHERE id = $1::uuid AND status = 'disabled'
	`
	tag, err := h.Service.DB.Exec(ctx, updateSQL, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı etkinleştirilemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Already enabled or missing — 204.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminUserEnabled,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

type grantRoleRequest struct {
	Role string `json:"role"`
}

// GrantRole implements POST /api/v1/admin/users/{id}/roles.
//
// Body: {"role": "admin" | "write" | "read"}.
// Idempotent: re-granting the same (user, role) pair is a no-op (PK conflict).
func (h *AdminHandlers) GrantRole(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}
	var req grantRoleRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if !validRoleName(req.Role) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"role 'admin', 'write' veya 'read' olmalı.", errors.New("bad role"))
		return
	}

	ctx := r.Context()

	const upsertSQL = `
		INSERT INTO user_roles (user_id, role_id, granted_by)
		SELECT $1::uuid, r.id, $3::uuid
		FROM roles r
		WHERE r.name = $2
		ON CONFLICT (user_id, role_id) DO NOTHING
	`
	tag, err := h.Service.DB.Exec(ctx, upsertSQL, id, req.Role, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Rol atanamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Role didn't exist OR user already has it — both result in idempotent 204.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminRoleGranted,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"role": req.Role},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// RevokeRole implements DELETE /api/v1/admin/users/{id}/roles/{role_name}.
//
// Self-strip-admin engeli: admin kendi 'admin' rolünü kaldıramaz (sistemde
// kalan tek admin'in kendini kilitlemesinden korur). Diğer admin'lerin
// kaldırması serbest.
func (h *AdminHandlers) RevokeRole(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	roleName := chi.URLParam(r, "role_name")
	if id == "" || roleName == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve role_name zorunlu.", errors.New("missing path params"))
		return
	}
	if !validRoleName(roleName) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"role 'admin', 'write' veya 'read' olmalı.", errors.New("bad role"))
		return
	}
	if id == claims.Subject && roleName == RoleAdmin {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kendi admin rolünüzü kaldıramazsınız.", errors.New("self-strip-admin"))
		return
	}

	ctx := r.Context()

	const deleteSQL = `
		DELETE FROM user_roles
		WHERE user_id = $1::uuid
		  AND role_id = (SELECT id FROM roles WHERE name = $2)
	`
	tag, err := h.Service.DB.Exec(ctx, deleteSQL, id, roleName)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Rol kaldırılamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Already not granted — idempotent 204.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminRoleRevoked,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"role": roleName},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// validRoleName checks against the seed in migrations/00003_roles.sql.
func validRoleName(name string) bool {
	switch name {
	case RoleAdmin, RoleWrite, RoleRead:
		return true
	}
	return false
}

// parseIntDefault returns def if s isn't a valid int OR is out of [min,max].
func parseIntDefault(s string, def, minVal, maxVal int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < minVal {
		return minVal
	}
	if n > maxVal {
		return maxVal
	}
	return n
}
