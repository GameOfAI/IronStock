package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
	"envanter.app/server/internal/notify"
	"envanter.app/server/internal/ws"
)

// loginRequest is the body of POST /api/v1/auth/login.
//
// totp_code is optional. If the user has an active TOTP secret configured,
// the code is required and verified. If no TOTP secret exists, the field is
// ignored and login succeeds with password alone. The error response is
// intentionally generic ("invalid credentials") regardless of which factor
// failed — denies the attacker an oracle.
type loginRequest struct {
	Username       string `json:"username"`
	Password       string `json:"master_password"`
	TOTPCode       string `json:"totp_code"`       // optional; required only when TOTP is configured
	RememberDevice bool   `json:"remember_device"` // PR-F2b: if true, issue a 30-day trusted-device cookie
}

type loginResponse struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	// ExpiresIn is the access-token lifetime in seconds. Refresh-token
	// lifetime is fixed (auth.RefreshTokenLifetime) and not echoed.
	ExpiresIn int      `json:"expires_in,omitempty"`
	TokenType string   `json:"token_type,omitempty"` // "Bearer"
	UserID    string   `json:"user_id,omitempty"`
	Roles     []string `json:"roles,omitempty"`
	// MustChangePassword signals that the user must complete a password change
	// before accessing the application. Set for admin-created accounts and the
	// default seed admin. Frontend redirects to /change-password and blocks
	// all other routes until the password is updated.
	MustChangePassword bool `json:"must_change_password,omitempty"`
	// MustSetupTOTP signals that the user's session is valid but they must
	// complete TOTP enrollment before accessing the application.
	// Set when totp_required=true and the user has no verified TOTP secret.
	// Frontend MustSetupTOTPGate redirects to /totp/setup and blocks all
	// other routes until enrollment is complete.
	// Note: when MustChangePassword=true, MustSetupTOTP is false — the
	// password gate fires first; TOTP gate activates on the next login.
	MustSetupTOTP bool `json:"must_setup_totp,omitempty"`
}

// Login implements POST /api/v1/auth/login.
//
// Steps:
//  1. Lookup user (by lowercased username), check status + lockout window.
//  2. Verify password. On failure: increment counter / set locked_until.
//  3. Decrypt TOTP secret, verify code. On failure: increment counter.
//  4. Both factors OK: reset counter, set last_login_at, create session row,
//     issue access + refresh tokens.
//  5. Audit auth.login on success, auth.login_fail on any failure.
//
// Generic error envelope: any password / TOTP / status / lockout failure
// returns 401 invalid_credentials. The audit log keeps the precise reason.
func (s *AuthHandlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"username ve master_password zorunlu.",
			errors.New("missing field"))
		return
	}

	ctx := r.Context()
	userRow, err := fetchUserForLogin(ctx, s.Service.DB, strings.ToLower(req.Username))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.recordLoginFail(ctx, r, "", "user_not_found")
			writeInvalidCreds(w, s.Logger, errors.New("user not found"))
			return
		}
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı sorgulanamadı.", err)
		return
	}

	// Status / lockout gates BEFORE we burn CPU on Argon2 — this is a tiny
	// timing channel (attacker learns "user exists, locked") but acceptable
	// per ADR-0004 §10. The alternative (always Argon2 then bail) costs ~50ms
	// per locked-account login attempt and helps brute force hardly at all.
	if userRow.Status == "disabled" {
		s.recordLoginFail(ctx, r, userRow.ID, "disabled")
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap devre dışı.", errors.New("disabled"))
		return
	}
	if auth.IsLocked(userRow.LockedUntil) {
		s.recordLoginFail(ctx, r, userRow.ID, "locked")
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap geçici olarak kilitli. Lütfen biraz sonra tekrar deneyin.",
			errors.New("locked"))
		return
	}

	// Verify password.
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

	// Verify TOTP only when the user has an active TOTP secret configured.
	totpEnc, err := fetchTOTPSecret(ctx, s.Service.DB, userRow.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"TOTP secret sorgulanamadı.", err)
		return
	}

	var trustedDeviceSkipped bool // PR-F2b: true when we skip TOTP via a valid cookie
	var trustedDeviceID string    // ID of the device row that was used (for audit)
	hasTOTP := err == nil         // true when user has an active TOTP secret

	// PR-SEC1/SEC2: 3-way branch based on TOTP enrollment and per-user requirement.
	//
	// Cases:
	//   A) hasTOTP=true                                → mevcut TOTP verify akışı (B'ye düşer)
	//   B) hasTOTP=false && totp_required=true         → full session + must_setup_totp=true
	//                                                     Frontend MustSetupTOTPGate → /totp/setup
	//   C) hasTOTP=false && totp_required=false        → şifre yeterli (knowledge-only)
	if !hasTOTP && userRow.TOTPRequired {
		// PR-SEC2: Issue a full session (not a tmp_token). The frontend gate blocks all
		// routes except /totp/setup until the user completes TOTP enrollment.
		// must_setup_totp is only set when must_change_password is false — if both
		// conditions are true, the password gate fires first; on the next login after
		// password change, must_change_password=false and must_setup_totp=true.
		enrollRefresh, enrollErr := auth.GenerateRefresh()
		if enrollErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Refresh token üretilemedi.", enrollErr)
			return
		}

		enrollTx, enrollTxErr := s.Service.DB.Begin(ctx)
		if enrollTxErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Veritabanı hatası.", enrollTxErr)
			return
		}
		defer func() { _ = enrollTx.Rollback(ctx) }()

		if err := recordLoginSuccess(ctx, enrollTx, userRow.ID); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Login durumu güncellenemedi.", err)
			return
		}

		enrollSessionID, enrollSessErr := auth.CreateSession(ctx, enrollTx,
			userRow.ID, enrollRefresh.Hash,
			r.UserAgent(), parseIP(r.RemoteAddr),
			enrollRefresh.ExpiresAt,
		)
		if enrollSessErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Oturum oluşturulamadı.", enrollSessErr)
			return
		}

		enrollRoles, enrollRolesErr := fetchUserRoles(ctx, enrollTx, userRow.ID)
		if enrollRolesErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Roller okunamadı.", enrollRolesErr)
			return
		}

		if err := enrollTx.Commit(ctx); err != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"İşlem tamamlanamadı.", err)
			return
		}

		enrollAccessToken, enrollATErr := s.Service.JWT.IssueAccess(userRow.ID, enrollSessionID, enrollRoles)
		if enrollATErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Access token üretilemedi.", enrollATErr)
			return
		}

		_ = s.Audit.Write(ctx, audit.Entry{
			ActorUserID:  userRow.ID,
			Action:       audit.ActionAuthLogin,
			ResourceType: audit.ResourceSession,
			ResourceID:   enrollSessionID,
			Details:      map[string]any{"stage": "totp_enroll_required"},
			IPAddress:    parseIP(r.RemoteAddr),
			UserAgent:    r.UserAgent(),
		})

		writeJSON(w, http.StatusOK, loginResponse{
			AccessToken:        enrollAccessToken,
			RefreshToken:       enrollRefresh.Token,
			ExpiresIn:          int(auth.AccessTokenLifetime.Seconds()),
			TokenType:          "Bearer",
			UserID:             userRow.ID,
			Roles:              enrollRoles,
			MustChangePassword: userRow.MustChangePassword,
			MustSetupTOTP:      !userRow.MustChangePassword,
		})
		return
	}

	if hasTOTP {
		// User has TOTP configured.
		// PR-F2b: check the trusted-device cookie first.
		if cookie, cookieErr := r.Cookie(trustedDeviceCookieName); cookieErr == nil {
			devID, ok, verifyErr := verifyTrustedDevice(ctx, s.Service.DB, userRow.ID, cookie.Value)
			if verifyErr == nil && ok {
				// Valid trusted device: skip TOTP code check.
				trustedDeviceSkipped = true
				trustedDeviceID = devID
			}
		}

		if !trustedDeviceSkipped {
			// No valid trusted device — code is required.
			if req.TOTPCode == "" {
				s.recordLoginFail(ctx, r, userRow.ID, "missing_totp")
				writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeMFARequired,
					"Bu hesap için 2FA kodu gerekli.", errors.New("totp required"))
				return
			}
			aad := crypto.MakeAAD("totp_secrets", userRow.ID, "secret_enc")
			totpSecret, totpDecErr := s.Service.Master.Open(totpEnc, aad)
			if totpDecErr != nil {
				writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"TOTP secret çözülemedi.", totpDecErr)
				return
			}
			if err := auth.VerifyTOTP(totpSecret, req.TOTPCode); err != nil {
				_ = recordLoginFailure(ctx, s.Service.DB, userRow.ID)
				s.recordLoginFail(ctx, r, userRow.ID, "wrong_totp")
				writeInvalidCreds(w, s.Logger, err)
				return
			}
		}
	}
	// At this point: hasTOTP=true (verified above) OR (hasTOTP=false && !totp_required).
	// Trusted-device verified, TOTP verified, or per-user TOTP requirement is off.
	// Password alone is sufficient.

	// All factors OK: create session in a tx so the failed-login counter
	// reset and session insert are atomic.
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

	roles, err := fetchUserRoles(ctx, tx, userRow.ID)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Roller okunamadı.", err)
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
		Action:       audit.ActionAuthLogin,
		ResourceType: audit.ResourceSession,
		ResourceID:   sessionID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	// PR-F2b: Trusted device — audit skip or create.
	if trustedDeviceSkipped {
		// TOTP was bypassed via a valid trusted-device cookie.
		_ = s.Audit.Write(ctx, audit.Entry{
			ActorUserID:  userRow.ID,
			Action:       audit.ActionTrustedDeviceUsed,
			ResourceType: "trusted_device",
			ResourceID:   trustedDeviceID,
			IPAddress:    parseIP(r.RemoteAddr),
			UserAgent:    r.UserAgent(),
		})
	} else if req.RememberDevice && hasTOTP {
		// User opted in to "remember device" after a fresh TOTP verify.
		// Issue a new device token and set the HttpOnly cookie.
		rawToken, tokenHash, tokenErr := generateDeviceToken()
		if tokenErr == nil {
			label := deviceLabelFromRequest(r)
			if devID, insertErr := createTrustedDevice(ctx, s.Service.DB, userRow.ID, tokenHash, label); insertErr == nil {
				expires := time.Now().Add(trustedDeviceTTL)
				setTrustedDeviceCookie(w, r, rawToken, expires)
				_ = s.Audit.Write(ctx, audit.Entry{
					ActorUserID:  userRow.ID,
					Action:       audit.ActionTrustedDeviceCreated,
					ResourceType: "trusted_device",
					ResourceID:   devID,
					IPAddress:    parseIP(r.RemoteAddr),
					UserAgent:    r.UserAgent(),
				})
			}
		}
	}

	// PR-N4: Break-glass emergency alert.
	// Fire-and-forget: do not block the login response.
	if userRow.IsBreakGlass {
		go s.emitBreakGlassAlert(userRow.ID, r.RemoteAddr, r.UserAgent())
	}

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

// userLoginRow holds the columns we need to authenticate.
type userLoginRow struct {
	ID                 string
	PasswordHash       []byte
	Argon2Params       []byte
	Status             string
	FailedAttempts     int
	LockedUntil        *time.Time
	MustChangePassword bool
	IsBreakGlass       bool // PR-N4 — triggers emergency alert on successful login
	TOTPRequired       bool // PR-SEC1 — per-user TOTP enforcement (default true)
}

// fetchUserForLogin returns the row needed to verify the password and check
// lockout state. Returns pgx.ErrNoRows if the username doesn't exist.
func fetchUserForLogin(ctx context.Context, db auth.DBExec, usernameLower string) (userLoginRow, error) {
	const sqlText = `
		SELECT id::text, password_hash, argon2_params,
		       status, failed_login_attempts, locked_until,
		       must_change_password, is_break_glass, totp_required
		FROM users
		WHERE username = $1
		LIMIT 1
	`
	var row userLoginRow
	err := db.QueryRow(ctx, sqlText, usernameLower).Scan(
		&row.ID, &row.PasswordHash, &row.Argon2Params,
		&row.Status, &row.FailedAttempts, &row.LockedUntil,
		&row.MustChangePassword, &row.IsBreakGlass, &row.TOTPRequired,
	)
	return row, err
}

// fetchTOTPSecret returns the encrypted TOTP secret blob for a user.
func fetchTOTPSecret(ctx context.Context, db auth.DBExec, userID string) ([]byte, error) {
	const sqlText = `
		SELECT secret_enc
		FROM totp_secrets
		WHERE user_id = $1::uuid AND verified = true
		LIMIT 1
	`
	var enc []byte
	err := db.QueryRow(ctx, sqlText, userID).Scan(&enc)
	return enc, err
}

// fetchUserRoles returns the role names for a user. Empty slice = no roles.
//
// Uses array_agg + COALESCE so we get exactly one row back (empty array
// when the user has no roles), letting us reuse QueryRow rather than
// growing the auth.DBExec interface with a Query method.
func fetchUserRoles(ctx context.Context, db auth.DBExec, userID string) ([]string, error) {
	const sqlText = `
		SELECT COALESCE(array_agg(r.name ORDER BY r.id), '{}')
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE ur.user_id = $1::uuid
	`
	var names []string
	err := db.QueryRow(ctx, sqlText, userID).Scan(&names)
	if err != nil {
		return nil, err
	}
	return names, nil
}

// recordLoginFailure increments the counter and locks the account if the
// threshold is hit. Runs in its own implicit-tx (no caller-supplied tx)
// because it must persist even when login fails (we deliberately don't
// roll it back).
func recordLoginFailure(ctx context.Context, db auth.DBExec, userID string) error {
	// Single SQL: increment, and if the new value would be >= max, set
	// locked_until and reset the counter. Postgres CASE keeps it atomic.
	const sqlText = `
		UPDATE users
		SET failed_login_attempts = CASE
		        WHEN failed_login_attempts + 1 >= $2 THEN 0
		        ELSE failed_login_attempts + 1
		    END,
		    locked_until = CASE
		        WHEN failed_login_attempts + 1 >= $2 THEN now() + ($3 * interval '1 second')
		        ELSE locked_until
		    END
		WHERE id = $1::uuid
	`
	_, err := db.Exec(ctx, sqlText, userID,
		auth.MaxFailedLoginAttempts,
		int(auth.LockoutDuration.Seconds()),
	)
	return err
}

// recordLoginSuccess clears failure state on a successful authentication.
func recordLoginSuccess(ctx context.Context, db auth.DBExec, userID string) error {
	const sqlText = `
		UPDATE users
		SET failed_login_attempts = 0,
		    locked_until = NULL,
		    last_login_at = now()
		WHERE id = $1::uuid
	`
	_, err := db.Exec(ctx, sqlText, userID)
	return err
}

// extractSaltFromParams pulls the base64 salt out of argon2_params jsonb.
// Layout written by /register: {... , "salt_b64": "..."}.
func extractSaltFromParams(paramsJSON []byte) ([]byte, error) {
	var bag struct {
		SaltB64 string `json:"salt_b64"`
	}
	if err := json.Unmarshal(paramsJSON, &bag); err != nil {
		return nil, err
	}
	if bag.SaltB64 == "" {
		return nil, errors.New("salt_b64 missing in argon2_params")
	}
	return base64.StdEncoding.DecodeString(bag.SaltB64)
}

// recordLoginFail emits an audit_log row for a failed attempt. ActorUserID is
// empty when the username didn't exist (we don't want to leak existence into
// the audit detail field beyond the action).
func (s *AuthHandlers) recordLoginFail(ctx context.Context, r *http.Request, userID, reason string) {
	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthLoginFail,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"reason": reason},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
}

// emitBreakGlassAlert runs asynchronously after a break-glass login (PR-N4).
// It:
//  1. Writes an auth.break_glass audit entry.
//  2. Publishes the EventBreakGlassLogin WS event (all admins see the alert banner).
//  3. Creates an in-app notification for every admin user.
func (s *AuthHandlers) emitBreakGlassAlert(userID, remoteAddr, userAgent string) {
	ctx := context.Background()

	// 1. Audit — break_glass supersedes the normal login entry.
	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthBreakGlass,
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"remote_addr": remoteAddr, "user_agent": userAgent},
	})

	// 2. WS event — all connected clients receive this; admin UI shows red banner.
	if s.Hub != nil {
		s.Hub.Publish(ws.NewEvent(ws.EventBreakGlassLogin, userID, "system"))
	}

	// 3. In-app notification for all admins.
	if s.Notify == nil {
		return
	}
	rows, err := s.Service.DB.Query(ctx, `
		SELECT u.id::text
		FROM users u
		JOIN user_roles ur ON ur.user_id = u.id
		JOIN roles r ON r.id = ur.role_id
		WHERE r.name = 'admin'
		  AND u.status = 'active'
		  AND u.id != $1::uuid
	`, userID)
	if err != nil {
		s.Logger.Warn("break_glass: failed to fetch admins", slog.String("error", err.Error()))
		return
	}
	defer rows.Close()
	for rows.Next() {
		var adminID string
		if err := rows.Scan(&adminID); err != nil {
			continue
		}
		s.Notify.Write(ctx, notify.Entry{
			UserID:       adminID,
			Type:         "break_glass",
			Title:        "⚠️ Acil Erişim Hesabı Kullanıldı!",
			Body:         "Bir break-glass hesabı sisteme giriş yaptı. Denetim günlüğünü kontrol edin.",
			ResourceType: "user",
			ResourceID:   userID,
		})
	}
}
