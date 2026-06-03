package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

// ─── Status ──────────────────────────────────────────────────────────────────

// BootstrapStatus implements GET /api/v1/auth/bootstrap/status.
//
// Public, unauthenticated. Returns {"setup_complete": true/false} so the
// frontend can decide which page to show (/admin-setup vs /admin-login).
func (s *AuthHandlers) BootstrapStatus(w http.ResponseWriter, r *http.Request) {
	if !s.BootstrapEnabled {
		writeError(w, s.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Bootstrap paneli bu sunucuda etkin değil.", errors.New("bootstrap disabled"))
		return
	}

	complete, err := adminExists(r.Context(), s.Service.DB)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Durum sorgulanamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"setup_complete": complete})
}

// ─── Setup ───────────────────────────────────────────────────────────────────

// BootstrapSetup implements POST /api/v1/auth/bootstrap/setup.
//
// Creates the FIRST and ONLY admin account.
// Fails with 409 Conflict if any admin already exists in the DB.
// The entire check+create is wrapped in a single transaction with a
// PostgreSQL advisory lock — two simultaneous requests cannot both succeed.
//
// Body: { "username": "...", "password": "..." }
// Returns JWT (auto-login) on 201 Created.
//
// Security invariants:
//   - Username 3-64 chars, password >= 12 chars
//   - Argon2id hash (same cost as regular register)
//   - Placeholder keypair (bootstrap admin is IAM-only, no E2E crypto)
//   - admin + write roles assigned in same transaction
//   - Audit log written
func (s *AuthHandlers) BootstrapSetup(w http.ResponseWriter, r *http.Request) {
	if !s.BootstrapEnabled {
		writeError(w, s.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Bootstrap paneli bu sunucuda etkin değil.", errors.New("bootstrap disabled"))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))

	if !usernameRE.MatchString(req.Username) {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kullanıcı adı 3-64 karakter, sadece harf/rakam/._- olabilir.", errors.New("invalid username"))
		return
	}
	if len(req.Password) < 12 {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Şifre en az 12 karakter olmalı.", errors.New("password too short"))
		return
	}

	ctx := r.Context()

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Advisory lock prevents a race between two simultaneous /setup calls.
	// Magic number 20100010 = "bootstrap setup" (arbitrary, project-unique).
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20100010)"); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kilit alınamadı.", err)
		return
	}

	exists, err := adminExistsTx(ctx, tx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Admin kontrolü yapılamadı.", err)
		return
	}
	if exists {
		writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
			"Admin hesabı zaten mevcut. /login ile giriş yapın.", errors.New("admin exists"))
		return
	}

	hp, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre işlenemedi.", err)
		return
	}

	const insertUser = `
		INSERT INTO users (username, email, password_hash, argon2_params, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id::text
	`
	var userID string
	err = tx.QueryRow(ctx, insertUser,
		req.Username,
		req.Username+"@bootstrap.local",
		hp.Hash,
		hp.ParamsJSON,
	).Scan(&userID)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, s.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu kullanıcı adı zaten kullanımda.", err)
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı oluşturulamadı.", err)
		return
	}

	if err := persistArgon2Salt(ctx, tx, userID, hp); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Argon2 parametreleri kaydedilemedi.", err)
		return
	}

	// Placeholder keypair: bootstrap admin is for IAM management only.
	// No client-side E2E crypto material is available at setup time.
	placeholderKEKParams, _ := json.Marshal(map[string]string{
		"alg":  "none",
		"note": "bootstrap-admin-placeholder",
	})
	const insertKeypair = `
		INSERT INTO user_keypairs (user_id, public_key, private_key_enc, kek_salt, kek_params)
		VALUES ($1, $2, $3, $4, $5)
	`
	if _, err := tx.Exec(ctx, insertKeypair,
		userID,
		make([]byte, 32), // public_key: 32 zero bytes (satisfies = 32 check)
		make([]byte, 1),  // private_key_enc: 1 byte (satisfies > 0 check)
		make([]byte, 16), // kek_salt: 16 zero bytes (satisfies >= 16 check)
		placeholderKEKParams,
	); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Anahtar çifti kaydedilemedi.", err)
		return
	}

	// Assign admin + write roles in the same transaction.
	const assignRoles = `
		INSERT INTO user_roles (user_id, role_id)
		SELECT $1::uuid, r.id FROM roles r WHERE r.name = ANY($2)
	`
	if _, err := tx.Exec(ctx, assignRoles, userID, []string{"admin", "write"}); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Roller atanamadı.", err)
		return
	}

	refresh, err := auth.GenerateRefresh()
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Refresh token üretilemedi.", err)
		return
	}

	sessionID, err := auth.CreateSession(ctx, tx,
		userID, refresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr),
		refresh.ExpiresAt,
	)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum oluşturulamadı.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	roles := []string{"admin", "write"}
	accessToken, err := s.Service.JWT.IssueAccess(userID, sessionID, roles)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Access token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthBootstrapSetup,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"via": "bootstrap_setup", "username": req.Username},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, loginResponse{
		AccessToken:  accessToken,
		RefreshToken: refresh.Token,
		ExpiresIn:    int(auth.AccessTokenLifetime.Seconds()),
		TokenType:    "Bearer",
		UserID:       userID,
		Roles:        roles,
	})
}

// ─── Login ───────────────────────────────────────────────────────────────────

// BootstrapLogin implements POST /api/v1/auth/bootstrap/login.
//
// TOTP-free login for an existing admin. Used after /setup completes,
// on subsequent sessions.
//
// Body: { "username": "...", "password": "..." }
//
// Security invariants (identical to regular login minus TOTP):
//   - Argon2id password verification
//   - admin role required
//   - disabled accounts rejected
//   - account lockout checked
//   - rate limiting applied via router middleware
//   - audit log written
func (s *AuthHandlers) BootstrapLogin(w http.ResponseWriter, r *http.Request) {
	if !s.BootstrapEnabled {
		writeError(w, s.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Bootstrap paneli bu sunucuda etkin değil. ENVANTER_BOOTSTRAP_ENABLED=true yapın.",
			errors.New("bootstrap disabled"))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))

	ctx := r.Context()
	userRow, err := fetchUserForLogin(ctx, s.Service.DB, req.Username)
	if err != nil {
		s.recordLoginFail(ctx, r, "", "user_not_found")
		writeInvalidCreds(w, s.Logger, errors.New("user not found"))
		return
	}

	if userRow.Status == "disabled" {
		s.recordLoginFail(ctx, r, userRow.ID, "disabled")
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap devre dışı.", errors.New("disabled"))
		return
	}

	if auth.IsLocked(userRow.LockedUntil) {
		s.recordLoginFail(ctx, r, userRow.ID, "locked")
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap geçici olarak kilitli. Lütfen biraz sonra tekrar deneyin.", errors.New("locked"))
		return
	}

	salt, err := extractSaltFromParams(userRow.Argon2Params)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre parametreleri okunamadı.", err)
		return
	}
	pwOK, err := auth.VerifyPassword(req.Password, userRow.PasswordHash, salt, userRow.Argon2Params)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Şifre doğrulanamadı.", err)
		return
	}
	if !pwOK {
		_ = recordLoginFailure(ctx, s.Service.DB, userRow.ID)
		s.recordLoginFail(ctx, r, userRow.ID, "wrong_password")
		writeInvalidCreds(w, s.Logger, errors.New("wrong password"))
		return
	}

	roles, err := fetchUserRoles(ctx, s.Service.DB, userRow.ID)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Roller okunamadı.", err)
		return
	}
	hasAdmin := false
	for _, role := range roles {
		if role == RoleAdmin {
			hasAdmin = true
			break
		}
	}
	if !hasAdmin {
		s.recordLoginFail(ctx, r, userRow.ID, "not_admin")
		writeInvalidCreds(w, s.Logger, errors.New("not admin"))
		return
	}

	refresh, err := auth.GenerateRefresh()
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Refresh token üretilemedi.", err)
		return
	}

	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := recordLoginSuccess(ctx, tx, userRow.ID); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Login durumu güncellenemedi.", err)
		return
	}

	sessionID, err := auth.CreateSession(ctx, tx,
		userRow.ID, refresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr),
		refresh.ExpiresAt,
	)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum oluşturulamadı.", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	accessToken, err := s.Service.JWT.IssueAccess(userRow.ID, sessionID, roles)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Access token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userRow.ID,
		Action:       audit.ActionAuthBootstrapLogin,
		ResourceType: audit.ResourceSession,
		ResourceID:   sessionID,
		Details:      map[string]any{"via": "bootstrap_login"},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken:        accessToken,
		RefreshToken:       refresh.Token,
		ExpiresIn:          int(auth.AccessTokenLifetime.Seconds()),
		TokenType:          "Bearer",
		UserID:             userRow.ID,
		Roles:              roles,
		MustChangePassword: userRow.MustChangePassword,
	})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// adminExists returns true if at least one user with the 'admin' role exists.
func adminExists(ctx context.Context, db *pgxpool.Pool) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM user_roles ur
			JOIN roles r ON ur.role_id = r.id
			WHERE r.name = 'admin'
		)
	`
	var exists bool
	err := db.QueryRow(ctx, q).Scan(&exists)
	return exists, err
}

// adminExistsTx is the same check but runs inside an existing transaction.
// auth.DBExec is satisfied by both *pgxpool.Pool and pgx.Tx.
func adminExistsTx(ctx context.Context, tx auth.DBExec) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM user_roles ur
			JOIN roles r ON ur.role_id = r.id
			WHERE r.name = 'admin'
		)
	`
	var exists bool
	err := tx.QueryRow(ctx, q).Scan(&exists)
	return exists, err
}
