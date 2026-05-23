package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

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
	ID                 string   `json:"id"`
	Username           string   `json:"username"`
	Email              string   `json:"email"`
	Status             string   `json:"status"`
	Roles              []string `json:"roles"`
	LastLoginAt        *string  `json:"last_login_at,omitempty"`
	CreatedAt          string   `json:"created_at"`
	IsBreakGlass       bool     `json:"is_break_glass"`        // PR-N4
	TOTPRequired        bool     `json:"totp_required"`          // PR-SEC1 — per-user TOTP enforcement
	RequiresClientCert  bool     `json:"requires_client_cert"`   // PR-SEC3 — mTLS client cert enforcement
	WebAuthnRequired    bool     `json:"webauthn_required"`      // PR-SEC4 — WebAuthn/FIDO2 enforcement
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

	// Page query — includes is_break_glass (PR-N4), totp_required (PR-SEC1),
	// requires_client_cert (PR-SEC3), and webauthn_required (PR-SEC4).
	const sqlText = `
		SELECT
		    COALESCE(array_agg(id::text                          ORDER BY username), '{}'),
		    COALESCE(array_agg(username                          ORDER BY username), '{}'),
		    COALESCE(array_agg(email                             ORDER BY username), '{}'),
		    COALESCE(array_agg(status                            ORDER BY username), '{}'),
		    COALESCE(array_agg(COALESCE(last_login_at::text, '') ORDER BY username), '{}'),
		    COALESCE(array_agg(created_at::text                  ORDER BY username), '{}'),
		    COALESCE(array_agg(is_break_glass                    ORDER BY username), '{}'),
		    COALESCE(array_agg(totp_required                     ORDER BY username), '{}'),
		    COALESCE(array_agg(requires_client_cert              ORDER BY username), '{}'),
		    COALESCE(array_agg(webauthn_required                 ORDER BY username), '{}')
		FROM (
		    SELECT id, username, email, status, last_login_at, created_at,
		           is_break_glass, totp_required, requires_client_cert, webauthn_required
		    FROM users
		    ORDER BY username
		    LIMIT $1 OFFSET $2
		) page
	`
	var ids, usernames, emails, statuses, lastLogins, createdAts []string
	var isBreakGlassFlags, totpRequiredFlags, requiresCertFlags, webauthnRequiredFlags []bool
	if err := h.Service.DB.QueryRow(ctx, sqlText, limit, offset).Scan(
		&ids, &usernames, &emails, &statuses, &lastLogins, &createdAts,
		&isBreakGlassFlags, &totpRequiredFlags, &requiresCertFlags, &webauthnRequiredFlags,
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
		breakGlass := i < len(isBreakGlassFlags) && isBreakGlassFlags[i]
		totpReq := i >= len(totpRequiredFlags) || totpRequiredFlags[i]  // default true if missing
		requiresCert := i < len(requiresCertFlags) && requiresCertFlags[i]
		webauthnReq := i < len(webauthnRequiredFlags) && webauthnRequiredFlags[i]
		out = append(out, adminUserRow{
			ID:                 ids[i],
			Username:           usernames[i],
			Email:              emails[i],
			Status:             statuses[i],
			Roles:              roles,
			LastLoginAt:        lastLogin,
			CreatedAt:          createdAts[i],
			IsBreakGlass:       breakGlass,
			TOTPRequired:       totpReq,
			RequiresClientCert: requiresCert,
			WebAuthnRequired:   webauthnReq,
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

// CreateUser implements POST /api/v1/admin/users.
//
// Admin tarafından kullanıcı oluşturur. Normal register'dan farkı:
//   - Client-side kripto yok; server placeholder keypair atar (bootstrap admin gibi).
//   - Kullanıcı direkt 'active' statüsünde açılır, TOTP kurulumu gerektirmez.
//   - Başlangıç rolleri req.Roles'dan atanır; boşsa ["read"] varsayılır.
//
// Body: { username, email, password, roles?, totp_required? }
// Returns: adminUserRow (201 Created)
//
// PR-SEC1: totp_required varsayılan true. Admin checkbox'ı kaldırırsa false gönderir.
func (h *AdminHandlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username            string   `json:"username"`
		Email               string   `json:"email"`
		Password            string   `json:"password"`
		Roles               []string `json:"roles"`
		TOTPRequired        *bool    `json:"totp_required"`         // nil → default true
		RequiresClientCert  *bool    `json:"requires_client_cert"`  // nil → default false (PR-SEC3)
	}
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}

	if !usernameRE.MatchString(req.Username) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kullanıcı adı 3-64 karakter, sadece harf/rakam/._- olabilir.", errors.New("invalid username"))
		return
	}
	if len(req.Email) < 3 || !strings.Contains(req.Email, "@") {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Geçerli bir e-posta adresi giriniz.", errors.New("invalid email"))
		return
	}
	if len(req.Password) < 12 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Şifre en az 12 karakter olmalı.", errors.New("password too short"))
		return
	}

	// Validate and default roles.
	roles := req.Roles
	if len(roles) == 0 {
		roles = []string{RoleRead}
	}
	for _, rn := range roles {
		if !validRoleName(rn) {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"Geçersiz rol: "+rn, errors.New("invalid role: "+rn))
			return
		}
	}

	hp, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre işlenemedi.", err)
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

	totpRequired := true // default
	if req.TOTPRequired != nil {
		totpRequired = *req.TOTPRequired
	}
	requiresClientCert := false // default
	if req.RequiresClientCert != nil {
		requiresClientCert = *req.RequiresClientCert
	}

	const insertUser = `
		INSERT INTO users (username, email, password_hash, argon2_params, status, must_change_password, totp_required, requires_client_cert)
		VALUES ($1, $2, $3, $4, 'active', true, $5, $6)
		RETURNING id::text, created_at::text
	`
	var userID, createdAt string
	err = tx.QueryRow(ctx, insertUser,
		strings.ToLower(req.Username),
		strings.ToLower(req.Email),
		hp.Hash,
		hp.ParamsJSON,
		totpRequired,
		requiresClientCert,
	).Scan(&userID, &createdAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Kullanıcı adı veya e-posta zaten kullanımda.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı oluşturulamadı.", err)
		return
	}

	if err := persistArgon2Salt(ctx, tx, userID, hp); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Argon2 parametreleri kaydedilemedi.", err)
		return
	}

	// Placeholder keypair — admin tarafında oluşturulan kullanıcılar E2E crypto
	// gerektirmez; kullanıcı ileride kendi keypair'ini kurabilir.
	const insertKeypair = `
		INSERT INTO user_keypairs (user_id, public_key, private_key_enc, kek_salt, kek_params)
		VALUES ($1, $2, $3, $4, $5)
	`
	placeholderKEKParams := []byte(`{"alg":"none","note":"admin-provisioned-placeholder"}`)
	if _, err := tx.Exec(ctx, insertKeypair,
		userID,
		make([]byte, 32),
		make([]byte, 1),
		make([]byte, 16),
		placeholderKEKParams,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti kaydedilemedi.", err)
		return
	}

	// Assign roles.
	const assignRoles = `
		INSERT INTO user_roles (user_id, role_id)
		SELECT $1::uuid, r.id FROM roles r WHERE r.name = ANY($2)
		ON CONFLICT DO NOTHING
	`
	if _, err := tx.Exec(ctx, assignRoles, userID, roles); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Roller atanamadı.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	claims := ClaimsFromContext(r.Context())
	actorID := ""
	if claims != nil {
		actorID = claims.Subject
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  actorID,
		Action:       audit.ActionAdminUserEnabled, // nearest semantic; dedicated constant Faz 6'da
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"username": strings.ToLower(req.Username), "roles": roles},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, adminUserRow{
		ID:           userID,
		Username:     strings.ToLower(req.Username),
		Email:        strings.ToLower(req.Email),
		Status:       "active",
		Roles:        roles,
		CreatedAt:    createdAt,
		TOTPRequired: totpRequired,
	})
}

// AdminResetTOTP implements POST /api/v1/admin/users/{id}/totp/reset.
//
// Clears the target user's TOTP secret and recovery codes, and sets
// users.status = 'pending_totp' so the user must re-enroll on next login.
// Intended for "I lost my phone" support scenarios.
func (h *AdminHandlers) AdminResetTOTP(w http.ResponseWriter, r *http.Request) {
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

	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`DELETE FROM totp_secrets WHERE user_id = $1::uuid`,
		id,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret silinemedi.", err)
		return
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM recovery_codes WHERE user_id = $1::uuid`,
		id,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Recovery code'lar silinemedi.", err)
		return
	}
	// Move user back to pending_totp so they must set up TOTP again before
	// being able to log in normally.
	if _, err := tx.Exec(ctx,
		`UPDATE users SET status = 'pending_totp' WHERE id = $1::uuid AND status <> 'disabled'`,
		id,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı statüsü güncellenemedi.", err)
		return
	}
	// Revoke all existing sessions so the user is forced to re-login.
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
		Action:       audit.ActionAdminTOTPReset,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// SetTOTPRequired implements PATCH /api/v1/admin/users/{id}/totp-required.
//
// Body: { "required": true | false }
//
// PR-SEC1: Per-user TOTP enforcement toggle. Admin tarafından çağrılır;
// admin kendi TOTP zorunluluğunu kapatamaz (self-lockdown protection).
//
// false → kullanıcı bir sonraki girişte sadece şifreyle giriş yapabilir
//         (varolan TOTP secret'ı korunur ama login akışı atlatır)
// true  → kullanıcı login için TOTP kurmak zorunda
func (h *AdminHandlers) SetTOTPRequired(w http.ResponseWriter, r *http.Request) {
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

	var body struct {
		Required bool `json:"required"`
	}
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	// Self-protection: admin kendi TOTP zorunluluğunu kapatamaz.
	if id == claims.Subject && !body.Required {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kendi hesabınızın TOTP zorunluluğunu kapatamazsınız.",
			errors.New("self-disable totp_required"))
		return
	}

	ctx := r.Context()
	tag, err := h.Service.DB.Exec(ctx,
		`UPDATE users SET totp_required = $2 WHERE id = $1::uuid`,
		id, body.Required,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP zorunluluğu güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Kullanıcı bulunamadı.", errors.New("no user"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminTOTPRequirementChanged,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"required": body.Required},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// SetBreakGlass implements POST /api/v1/admin/users/{id}/break-glass.
// Enables or disables the break-glass flag on a user account.
// The target user must already have the admin role; the application
// enforces this to prevent privilege escalation.
func (h *AdminHandlers) SetBreakGlass(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeMiddlewareUnauthorized(w, errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	// Decode body: { "enabled": true|false }
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	// Validate target user has admin role.
	var isAdmin bool
	err := h.Service.DB.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM user_roles ur
		    JOIN roles r ON r.id = ur.role_id
		    WHERE ur.user_id = $1::uuid AND r.name = 'admin'
		)
	`, id).Scan(&isAdmin)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı doğrulanamadı.", err)
		return
	}
	if !isAdmin {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Yalnızca admin rolündeki kullanıcılar break-glass olabilir.", errors.New("not admin"))
		return
	}

	_, err = h.Service.DB.Exec(ctx,
		`UPDATE users SET is_break_glass = $2 WHERE id = $1::uuid`,
		id, body.Enabled,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Break-glass durumu güncellenemedi.", err)
		return
	}

	action := "admin.break_glass_enabled"
	if !body.Enabled {
		action = "admin.break_glass_disabled"
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       action,
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"enabled": body.Enabled},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// SetWebAuthnRequired implements PATCH /api/v1/admin/users/{id}/webauthn-required.
//
// Body: { "required": true | false }
//
// PR-SEC4: Per-user WebAuthn enforcement toggle. When true, the user must
// authenticate with a registered FIDO2/WebAuthn credential in addition to
// (or instead of) TOTP for each login.
func (h *AdminHandlers) SetWebAuthnRequired(w http.ResponseWriter, r *http.Request) {
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

	var body struct {
		Required bool `json:"required"`
	}
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	ctx := r.Context()
	tag, err := h.Service.DB.Exec(ctx,
		`UPDATE users SET webauthn_required = $2 WHERE id = $1::uuid`,
		id, body.Required,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"WebAuthn zorunluluğu güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Kullanıcı bulunamadı.", errors.New("no user"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       "admin.webauthn_requirement_changed",
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      map[string]any{"required": body.Required},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
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
