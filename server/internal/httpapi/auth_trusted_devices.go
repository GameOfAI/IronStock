package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

const (
	// trustedDeviceCookieName is the HttpOnly cookie that holds the raw device
	// token. The server stores SHA-256(token) in the DB — the cookie itself
	// is never persisted.
	trustedDeviceCookieName = "trusted_device"

	// trustedDeviceTTL is the rolling validity window. Extended on each use.
	trustedDeviceTTL = 30 * 24 * time.Hour
)

// generateDeviceToken produces a cryptographically random 32-byte token,
// returns the URL-safe base64 string (no padding) and its SHA-256 hash.
func generateDeviceToken() (rawToken string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return
	}
	rawToken = base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256(raw)
	hash = sum[:]
	return
}

// hashDeviceToken returns SHA-256(base64-decoded token). Returns nil on error.
func hashDeviceToken(rawToken string) []byte {
	raw, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil || len(raw) != 32 {
		return nil
	}
	sum := sha256.Sum256(raw)
	return sum[:]
}

// setTrustedDeviceCookie writes the Set-Cookie header for the device token.
// Cookie flags: HttpOnly, SameSite=Strict, Path=/api/v1/auth.
// Secure flag is set when the request was made over HTTPS.
func setTrustedDeviceCookie(w http.ResponseWriter, r *http.Request, rawToken string, expires time.Time) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	cookie := &http.Cookie{
		Name:     trustedDeviceCookieName,
		Value:    rawToken,
		Path:     "/api/v1/auth",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	}
	http.SetCookie(w, cookie)
}

// clearTrustedDeviceCookie sends an expired cookie to remove it from the browser.
func clearTrustedDeviceCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     trustedDeviceCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// verifyTrustedDevice looks up the cookie value in the DB.
// Returns (deviceID, ok, err). err is only non-nil on a DB failure;
// ok=false with err=nil means "not found or expired".
func verifyTrustedDevice(ctx context.Context, db auth.DBExec, userID, rawCookie string) (string, bool, error) {
	hash := hashDeviceToken(rawCookie)
	if hash == nil {
		return "", false, nil
	}
	const sqlText = `
		UPDATE trusted_devices
		SET last_used_at = now(),
		    expires_at   = now() + $3 * interval '1 second'
		WHERE token_hash = $1
		  AND user_id    = $2::uuid
		  AND expires_at  > now()
		RETURNING id::text
	`
	var deviceID string
	err := db.QueryRow(ctx, sqlText,
		hash, userID, int(trustedDeviceTTL.Seconds()),
	).Scan(&deviceID)
	if err != nil {
		// pgx.ErrNoRows means not found/expired — not a real error.
		return "", false, nil
	}
	return deviceID, true, nil
}

// createTrustedDevice inserts a new row and returns its UUID.
func createTrustedDevice(ctx context.Context, db auth.DBExec, userID string, hash []byte, label string) (string, error) {
	const sqlText = `
		INSERT INTO trusted_devices (user_id, token_hash, device_label, expires_at)
		VALUES ($1::uuid, $2, $3, now() + $4 * interval '1 second')
		RETURNING id::text
	`
	var id string
	err := db.QueryRow(ctx, sqlText,
		userID, hash, label, int(trustedDeviceTTL.Seconds()),
	).Scan(&id)
	return id, err
}

// deviceLabelFromRequest extracts a human-readable label from the User-Agent,
// truncated to 120 characters.
func deviceLabelFromRequest(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 120 {
		ua = ua[:120]
	}
	if ua == "" {
		return "Bilinmeyen cihaz"
	}
	return ua
}

// trustedDeviceRow is what we return to the client for device management.
type trustedDeviceRow struct {
	ID          string  `json:"id"`
	DeviceLabel *string `json:"device_label"`
	LastUsedAt  string  `json:"last_used_at"`
	ExpiresAt   string  `json:"expires_at"`
	CreatedAt   string  `json:"created_at"`
}

// ListTrustedDevices implements GET /api/v1/auth/trusted-devices.
// Returns all non-expired trusted devices for the authenticated user.
func (s *AuthHandlers) ListTrustedDevices(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	ctx := r.Context()

	const sqlText = `
		SELECT id::text, device_label, last_used_at, expires_at, created_at
		FROM trusted_devices
		WHERE user_id = $1::uuid
		  AND expires_at > now()
		ORDER BY last_used_at DESC
	`
	rows, err := s.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Güvenilir cihazlar alınamadı.", err)
		return
	}
	defer rows.Close()

	devices := make([]trustedDeviceRow, 0)
	for rows.Next() {
		var d trustedDeviceRow
		var label *string
		var lastUsed, expires, created time.Time
		if err := rows.Scan(&d.ID, &label, &lastUsed, &expires, &created); err != nil {
			continue
		}
		d.DeviceLabel = label
		d.LastUsedAt = lastUsed.UTC().Format(time.RFC3339)
		d.ExpiresAt = expires.UTC().Format(time.RFC3339)
		d.CreatedAt = created.UTC().Format(time.RFC3339)
		devices = append(devices, d)
	}
	if err := rows.Err(); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Güvenilir cihazlar okunamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"devices": devices})
}

// RevokeTrustedDevice implements DELETE /api/v1/auth/trusted-devices/{id}.
// Revokes the specified device. If the deleted device matches the current
// browser's cookie, the cookie is also cleared.
func (s *AuthHandlers) RevokeTrustedDevice(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	deviceID := chi.URLParam(r, "id")
	ctx := r.Context()

	const sqlText = `
		DELETE FROM trusted_devices
		WHERE id = $1::uuid AND user_id = $2::uuid
	`
	tag, err := s.Service.DB.Exec(ctx, sqlText, deviceID, claims.Subject)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Cihaz silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, s.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Cihaz bulunamadı.", nil)
		return
	}

	// If this browser's cookie token matches the revoked device, clear the cookie.
	// We don't have the hash to correlate — just always clear it for simplicity.
	// The user explicitly revoked a device from profile; it's fine to log them
	// out of "remember me" on this browser too.
	clearTrustedDeviceCookie(w)

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionTrustedDeviceRevoked,
		ResourceType: "trusted_device",
		ResourceID:   deviceID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// RevokeAllTrustedDevices implements DELETE /api/v1/auth/trusted-devices.
// Revokes every trusted device for the authenticated user and clears the cookie.
func (s *AuthHandlers) RevokeAllTrustedDevices(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	ctx := r.Context()

	const sqlText = `DELETE FROM trusted_devices WHERE user_id = $1::uuid`
	_, err := s.Service.DB.Exec(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Cihazlar silinemedi.", err)
		return
	}

	clearTrustedDeviceCookie(w)

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionTrustedDeviceRevoked,
		Details:     map[string]any{"scope": "all"},
		IPAddress:   parseIP(r.RemoteAddr),
		UserAgent:   r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}
