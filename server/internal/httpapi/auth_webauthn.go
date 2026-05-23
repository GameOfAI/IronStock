package httpapi

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	webauthnpkg "envanter.app/server/internal/webauthn"
)

// ─── WebAuthn Handlers ──────────────────────────────────────────────────────
//
// PR-SEC4: WebAuthn / FIDO2 / YubiKey second factor.
//
// Registration flow (authenticated user adds a new key):
//   POST /api/v1/auth/webauthn/register/begin   → challenge options + session_key
//   POST /api/v1/auth/webauthn/register/finish  → stores credential
//
// Login flow (standalone, replaces password+TOTP):
//   POST /api/v1/auth/webauthn/login/begin    body: {username} → assertion options
//   POST /api/v1/auth/webauthn/login/finish   body: {user_id, session_key, credential}
//
// Credential management (authenticated):
//   GET    /api/v1/auth/webauthn/credentials
//   PUT    /api/v1/auth/webauthn/credentials/{id}
//   DELETE /api/v1/auth/webauthn/credentials/{id}

// webAuthnCheck returns false and writes 501 if the WebAuthn service is not configured.
func (s *AuthHandlers) webAuthnCheck(w http.ResponseWriter) bool {
	if s.WebAuthn == nil {
		writeError(w, s.Logger, http.StatusNotImplemented, "not_configured",
			"WebAuthn is not configured on this server.", nil)
		return false
	}
	return true
}

// fetchUsernameByID looks up a user's username given their UUID.
func (s *AuthHandlers) fetchUsernameByID(r *http.Request, userID string) (string, bool) {
	var username string
	err := s.Service.DB.QueryRow(r.Context(),
		`SELECT username FROM users WHERE id = $1::uuid AND status != 'disabled'`,
		userID,
	).Scan(&username)
	return username, err == nil
}

// ─── begin registration ──────────────────────────────────────────────────────

// WebAuthnRegisterBegin implements POST /api/v1/auth/webauthn/register/begin.
// Requires a valid access token.
func (s *AuthHandlers) WebAuthnRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}
	username, ok := s.fetchUsernameByID(r, claims.Subject)
	if !ok {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı bilgisi alınamadı.", nil)
		return
	}

	user, err := s.WebAuthn.LoadUser(r.Context(), claims.Subject, username)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı yüklenemedi.", err)
		return
	}

	options, sessionKey, err := s.WebAuthn.BeginRegistration(user)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kayıt başlatılamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"options":     options,
		"session_key": sessionKey,
	})
}

// ─── finish registration ─────────────────────────────────────────────────────

// WebAuthnRegisterFinish implements POST /api/v1/auth/webauthn/register/finish.
// Client sends:
//
//	{ "session_key": "...", "label": "YubiKey 5", "credential": { <WebAuthn response> } }
func (s *AuthHandlers) WebAuthnRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Gövde okunamadı.", err)
		return
	}

	var envelope struct {
		SessionKey string          `json:"session_key"`
		Label      string          `json:"label"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.SessionKey == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"session_key ve credential gerekli.", nil)
		return
	}
	if envelope.Label == "" {
		envelope.Label = "Güvenlik Anahtarı"
	}

	username, ok := s.fetchUsernameByID(r, claims.Subject)
	if !ok {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı bilgisi alınamadı.", nil)
		return
	}

	user, err := s.WebAuthn.LoadUser(r.Context(), claims.Subject, username)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı yüklenemedi.", err)
		return
	}

	cred, err := s.WebAuthn.FinishRegistration(user, envelope.SessionKey, envelope.Credential)
	if err != nil {
		s.Logger.Warn("webauthn: register finish failed", "user_id", claims.Subject, "err", err)
		writeError(w, s.Logger, http.StatusBadRequest, "webauthn_error",
			"Kayıt doğrulaması başarısız: "+err.Error(), nil)
		return
	}

	if err := s.WebAuthn.SaveCredential(r.Context(), claims.Subject, envelope.Label, cred); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Credential kaydedilemedi.", err)
		return
	}

	_ = s.Audit.Write(r.Context(), audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthWebAuthnRegistered,
		ResourceType: "webauthn_credential",
		ResourceID:   claims.Subject,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, map[string]string{"label": envelope.Label})
}

// ─── begin login ─────────────────────────────────────────────────────────────

// WebAuthnLoginBegin implements POST /api/v1/auth/webauthn/login/begin.
// Body: { "username": "..." }
func (s *AuthHandlers) WebAuthnLoginBegin(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}

	var req struct {
		Username string `json:"username"`
	}
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.Username == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, "username gerekli.", nil)
		return
	}

	var userID string
	err := s.Service.DB.QueryRow(r.Context(),
		`SELECT id::text FROM users WHERE lower(username) = lower($1) AND status != 'disabled'`,
		req.Username,
	).Scan(&userID)
	if err != nil {
		// No enumeration — same generic error.
		writeError(w, s.Logger, http.StatusBadRequest, "invalid_credentials",
			"Geçerli credential bulunamadı.", nil)
		return
	}

	user, err := s.WebAuthn.LoadUser(r.Context(), userID, req.Username)
	if err != nil || len(user.Credentials) == 0 {
		writeError(w, s.Logger, http.StatusBadRequest, "invalid_credentials",
			"Geçerli credential bulunamadı.", nil)
		return
	}

	options, sessionKey, err := s.WebAuthn.BeginLogin(user)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Login başlatılamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"options":     options,
		"session_key": sessionKey,
		"user_id":     userID,
	})
}

// ─── finish login ─────────────────────────────────────────────────────────────

// WebAuthnLoginFinish implements POST /api/v1/auth/webauthn/login/finish.
// Client sends:
//
//	{ "user_id": "...", "session_key": "...", "credential": { <assertion response> } }
//
// On success returns the same loginResponse as POST /auth/login.
func (s *AuthHandlers) WebAuthnLoginFinish(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, "Gövde okunamadı.", err)
		return
	}

	var envelope struct {
		UserID     string          `json:"user_id"`
		SessionKey string          `json:"session_key"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil ||
		envelope.UserID == "" || envelope.SessionKey == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"user_id, session_key ve credential gerekli.", nil)
		return
	}

	username, ok := s.fetchUsernameByID(r, envelope.UserID)
	if !ok {
		writeError(w, s.Logger, http.StatusUnauthorized, "invalid_credentials",
			"Geçersiz kimlik bilgileri.", nil)
		return
	}

	user, err := s.WebAuthn.LoadUser(r.Context(), envelope.UserID, username)
	if err != nil || len(user.Credentials) == 0 {
		writeError(w, s.Logger, http.StatusUnauthorized, "invalid_credentials",
			"Geçersiz kimlik bilgileri.", nil)
		return
	}

	cred, err := s.WebAuthn.FinishLogin(user, envelope.SessionKey, envelope.Credential)
	if err != nil {
		s.Logger.Warn("webauthn: login finish failed", "user_id", envelope.UserID, "err", err)
		_ = s.Audit.Write(r.Context(), audit.Entry{
			ActorUserID: envelope.UserID,
			Action:      audit.ActionAuthWebAuthnFailed,
			IPAddress:   parseIP(r.RemoteAddr),
			UserAgent:   r.UserAgent(),
		})
		writeError(w, s.Logger, http.StatusUnauthorized, "invalid_credentials",
			"Geçersiz kimlik bilgileri.", nil)
		return
	}

	// Update sign counter to prevent cloning.
	if err := s.WebAuthn.UpdateSignCount(r.Context(), cred.ID, cred.Authenticator.SignCount); err != nil {
		s.Logger.Error("webauthn: update sign count failed", "err", err)
	}

	// Issue session tokens (same flow as /auth/login after all factors verified).
	ctx := r.Context()
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

	sessionID, err := auth.CreateSession(ctx, tx,
		envelope.UserID, refresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr),
		refresh.ExpiresAt,
	)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum oluşturulamadı.", err)
		return
	}

	roles, err := fetchUserRoles(ctx, tx, envelope.UserID)
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

	accessToken, err := s.Service.JWT.IssueAccess(envelope.UserID, sessionID, roles)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Access token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  envelope.UserID,
		Action:       audit.ActionAuthWebAuthnLogin,
		ResourceType: audit.ResourceSession,
		ResourceID:   sessionID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken:  accessToken,
		RefreshToken: refresh.Token,
		ExpiresIn:    int(auth.AccessTokenLifetime.Seconds()),
		TokenType:    "Bearer",
		UserID:       envelope.UserID,
		Roles:        roles,
	})
}

// ─── credential management ────────────────────────────────────────────────────

// WebAuthnListCredentials implements GET /api/v1/auth/webauthn/credentials.
func (s *AuthHandlers) WebAuthnListCredentials(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}
	creds, err := s.WebAuthn.ListCredentials(r.Context(), claims.Subject)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Credential listesi alınamadı.", err)
		return
	}
	if creds == nil {
		creds = []webauthnpkg.CredentialInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"credentials": creds})
}

// WebAuthnUpdateCredential implements PUT /api/v1/auth/webauthn/credentials/{id}.
func (s *AuthHandlers) WebAuthnUpdateCredential(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}
	credID := chi.URLParam(r, "id")

	var req struct {
		Label string `json:"label"`
	}
	if !decodeJSON(w, r, s.Logger, &req) || req.Label == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest, "label gerekli.", nil)
		return
	}

	if err := s.WebAuthn.UpdateCredentialLabel(r.Context(), claims.Subject, credID, req.Label); err != nil {
		writeError(w, s.Logger, http.StatusNotFound, ErrCodeNotFound, "Credential bulunamadı.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"label": req.Label})
}

// WebAuthnDeleteCredential implements DELETE /api/v1/auth/webauthn/credentials/{id}.
func (s *AuthHandlers) WebAuthnDeleteCredential(w http.ResponseWriter, r *http.Request) {
	if !s.webAuthnCheck(w) {
		return
	}
	claims, ok := s.requireAccessToken(w, r)
	if !ok {
		return
	}
	credID := chi.URLParam(r, "id")

	if err := s.WebAuthn.DeleteCredential(r.Context(), claims.Subject, credID); err != nil {
		writeError(w, s.Logger, http.StatusNotFound, ErrCodeNotFound, "Credential bulunamadı.", nil)
		return
	}

	_ = s.Audit.Write(r.Context(), audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAuthWebAuthnRemoved,
		ResourceType: "webauthn_credential",
		ResourceID:   credID,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}
