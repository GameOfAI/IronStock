package httpapi

// PR-LDAP: SSO / LDAP authentication handlers.
//
// Two provider types are supported:
//   - 'ldap' — LDAP simple-bind + user search (Active Directory / OpenLDAP)
//   - 'oidc' — OpenID Connect authorization-code flow (Azure AD, Okta, …)
//
// OIDC is implemented without an external library: we manually fetch the
// discovery document, build the authorization URL with PKCE, exchange the
// code at the token endpoint, and parse the returned ID token JWT payload.
// The token is trusted because it was obtained directly from the provider's
// HTTPS endpoint. Full JWKS signature verification can be layered on later.
//
// Both flows end by finding or auto-provisioning a local IronStock user and
// issuing a standard access+refresh token pair (same as password login).

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	ldap "github.com/go-ldap/ldap/v3"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// ─────────────────────────────────────────────
//  OIDC state store (in-memory, single-pod MVP)
// ─────────────────────────────────────────────

// oidcStateEntry holds metadata for a pending OIDC flow.
// It expires after 10 minutes — enough for a user to authenticate
// and have the provider redirect back. Multi-pod deployments should
// replace this with a Redis/DB-backed store.
type oidcStateEntry struct {
	ProviderID    string
	PKCEVerifier  string
	ExpiresAt     time.Time
}

var (
	oidcStateMu    sync.Mutex
	oidcStateStore = map[string]oidcStateEntry{}
)

func issueOIDCState(providerID, pkceVerifier string) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	state := base64.RawURLEncoding.EncodeToString(b)

	oidcStateMu.Lock()
	defer oidcStateMu.Unlock()
	// GC: evict expired entries.
	now := time.Now()
	for k, v := range oidcStateStore {
		if now.After(v.ExpiresAt) {
			delete(oidcStateStore, k)
		}
	}
	oidcStateStore[state] = oidcStateEntry{
		ProviderID:   providerID,
		PKCEVerifier: pkceVerifier,
		ExpiresAt:    now.Add(10 * time.Minute),
	}
	return state
}

func consumeOIDCState(state string) (oidcStateEntry, bool) {
	oidcStateMu.Lock()
	defer oidcStateMu.Unlock()
	e, ok := oidcStateStore[state]
	if !ok {
		return oidcStateEntry{}, false
	}
	delete(oidcStateStore, state)
	if time.Now().After(e.ExpiresAt) {
		return oidcStateEntry{}, false
	}
	return e, true
}

// ─────────────────────────────────────────────
//  Shared DB helpers
// ─────────────────────────────────────────────

type ssoProviderRow struct {
	ID                  string
	Name                string
	ProviderType        string
	Enabled             bool
	DiscoveryURL        *string
	ClientID            *string
	ClientSecretEnc     []byte
	Scopes              []string
	LDAPUrl             *string
	LDAPBindDN          *string
	LDAPBindPasswordEnc []byte
	LDAPUserSearchBase  *string
	LDAPUserFilter      string
	LDAPAttrUsername    string
	LDAPAttrEmail       string
	LDAPAttrDisplayName string
	LDAPUseStartTLS     bool
	LDAPSkipTLSVerify   bool
	AutoProvision       bool
	DefaultRole         string
}

const ssoProviderSQL = `
SELECT id::text, name, provider_type, enabled,
       discovery_url, client_id, client_secret_enc, scopes,
       ldap_url, ldap_bind_dn, ldap_bind_password_enc,
       ldap_user_search_base, ldap_user_filter,
       ldap_attr_username, ldap_attr_email, ldap_attr_display_name,
       ldap_use_starttls, ldap_skip_tls_verify,
       auto_provision, default_role
FROM sso_providers
WHERE id = $1::uuid AND enabled = true
`

func fetchSSOProvider(ctx context.Context, db auth.DBExec, id string) (ssoProviderRow, error) {
	var p ssoProviderRow
	err := db.QueryRow(ctx, ssoProviderSQL, id).Scan(
		&p.ID, &p.Name, &p.ProviderType, &p.Enabled,
		&p.DiscoveryURL, &p.ClientID, &p.ClientSecretEnc, &p.Scopes,
		&p.LDAPUrl, &p.LDAPBindDN, &p.LDAPBindPasswordEnc,
		&p.LDAPUserSearchBase, &p.LDAPUserFilter,
		&p.LDAPAttrUsername, &p.LDAPAttrEmail, &p.LDAPAttrDisplayName,
		&p.LDAPUseStartTLS, &p.LDAPSkipTLSVerify,
		&p.AutoProvision, &p.DefaultRole,
	)
	return p, err
}

// findOrProvisionSSOUser looks up an existing user_sso_identities row and
// returns the linked IronStock user ID. If not found and auto_provision=true,
// a new local user is created with the given email/displayName.
func findOrProvisionSSOUser(
	ctx context.Context,
	db auth.DBExec,
	p ssoProviderRow,
	externalID, email, displayName string,
) (string, error) {
	// 1. Existing identity link?
	var userID string
	err := db.QueryRow(ctx, `
		SELECT user_id::text
		FROM user_sso_identities
		WHERE provider_id = $1::uuid AND external_id = $2
	`, p.ID, externalID).Scan(&userID)

	if err == nil {
		// Update last_login_at + email cache (best-effort).
		_, _ = db.Exec(ctx, `
			UPDATE user_sso_identities
			SET last_login_at = NOW(), external_email = $3
			WHERE provider_id = $1::uuid AND external_id = $2
		`, p.ID, externalID, email)
		return userID, nil
	}

	if !isNoRowsErr(err) {
		return "", fmt.Errorf("sso identity lookup: %w", err)
	}

	// 2. Auto-provision?
	if !p.AutoProvision {
		return "", errors.New("user not found and auto-provision is disabled for this provider")
	}
	if email == "" {
		return "", errors.New("email required for auto-provisioning (provider did not return email attribute)")
	}

	// Derive username from email prefix.
	username := strings.ToLower(strings.Split(email, "@")[0])
	// Make it unique if taken.
	var taken bool
	if scanErr := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, username).Scan(&taken); scanErr != nil {
		return "", scanErr
	}
	if taken {
		sfx := make([]byte, 3)
		_, _ = rand.Read(sfx)
		username = fmt.Sprintf("%s_%x", username, sfx)
	}

	// Create the user with a random, unguessable password_hash placeholder
	// (SSO users never use their local password).
	randPwBytes := make([]byte, 32)
	_, _ = rand.Read(randPwBytes)
	placeholder := base64.StdEncoding.EncodeToString(randPwBytes)

	tx, txErr := db.Begin(ctx)
	if txErr != nil {
		return "", txErr
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var newUserID string
	insertErr := tx.QueryRow(ctx, `
		INSERT INTO users (username, email, display_name, password_hash, argon2_params, status,
		                   must_change_password, totp_required)
		VALUES ($1, $2, $3, $4::bytea, '{"placeholder":true}'::jsonb, 'active', false, false)
		RETURNING id::text
	`, username, email, displayName, []byte(placeholder)).Scan(&newUserID)
	if insertErr != nil {
		return "", fmt.Errorf("auto-provision user: %w", insertErr)
	}

	// Assign default role.
	if p.DefaultRole != "" {
		if _, roleErr := tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id)
			SELECT $1::uuid, id FROM roles WHERE name = $2
			ON CONFLICT DO NOTHING
		`, newUserID, p.DefaultRole); roleErr != nil {
			return "", fmt.Errorf("auto-provision role: %w", roleErr)
		}
	}

	// Create SSO identity link.
	if _, idErr := tx.Exec(ctx, `
		INSERT INTO user_sso_identities (user_id, provider_id, external_id, external_email, last_login_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, NOW())
	`, newUserID, p.ID, externalID, email); idErr != nil {
		return "", fmt.Errorf("auto-provision identity: %w", idErr)
	}

	if commitErr := tx.Commit(ctx); commitErr != nil {
		return "", commitErr
	}
	return newUserID, nil
}

// isNoRowsErr returns true when the error signals "no rows in result set".
func isNoRowsErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no rows")
}

// issueSessionForSSO creates a session and writes a JSON loginResponse for
// a successfully authenticated SSO user.
func (s *AuthHandlers) issueSessionForSSO(
	ctx context.Context,
	w http.ResponseWriter,
	r *http.Request,
	userID, providerName string,
) {
	var status string
	var mustChangePwd bool
	if err := s.Service.DB.QueryRow(ctx,
		`SELECT status, must_change_password FROM users WHERE id = $1::uuid`, userID,
	).Scan(&status, &mustChangePwd); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kullanıcı bilgisi alınamadı.", err)
		return
	}
	if status == "disabled" {
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
			"Hesap devre dışı.", errors.New("disabled"))
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
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal, "Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := recordLoginSuccess(ctx, tx, userID); err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Login durumu güncellenemedi.", err)
		return
	}
	sessionID, err := auth.CreateSession(ctx, tx, userID, refresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr), refresh.ExpiresAt)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Oturum oluşturulamadı.", err)
		return
	}
	roles, err := fetchUserRoles(ctx, tx, userID)
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

	accessToken, err := s.Service.JWT.IssueAccess(userID, sessionID, roles)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Access token üretilemedi.", err)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthLogin,
		ResourceType: audit.ResourceSession,
		ResourceID:   sessionID,
		Details:      map[string]any{"via": "sso", "provider": providerName},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken:        accessToken,
		RefreshToken:       refresh.Token,
		ExpiresIn:          int(auth.AccessTokenLifetime.Seconds()),
		TokenType:          "Bearer",
		UserID:             userID,
		Roles:              roles,
		MustChangePassword: mustChangePwd,
	})
}

// ─────────────────────────────────────────────
//  GET /api/v1/auth/sso/providers
// ─────────────────────────────────────────────

// ListSSOProviders returns public metadata about enabled SSO providers.
// The login page calls this to render SSO / LDAP buttons.
func (s *AuthHandlers) ListSSOProviders(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := s.Service.DB.Query(ctx, `
		SELECT id::text, name, provider_type
		FROM sso_providers WHERE enabled = true ORDER BY name
	`)
	if err != nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"SSO sağlayıcıları listelenemedi.", err)
		return
	}
	defer rows.Close()

	type providerInfo struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		ProviderType string `json:"provider_type"`
	}
	providers := []providerInfo{}
	for rows.Next() {
		var p providerInfo
		if err := rows.Scan(&p.ID, &p.Name, &p.ProviderType); err == nil {
			providers = append(providers, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": providers})
}

// ─────────────────────────────────────────────
//  LDAP login — POST /api/v1/auth/ldap/login
// ─────────────────────────────────────────────

type ldapLoginRequest struct {
	ProviderID string `json:"provider_id"`
	Username   string `json:"username"`
	Password   string `json:"password"` //nolint:tagliatelle
}

// LDAPLogin authenticates against an LDAP/AD server.
//
// Flow:
//  1. Load + decrypt provider config (bind password via master key).
//  2. Connect to LDAP; optional StartTLS.
//  3. Bind as service account; search for user DN by configured filter.
//  4. Bind as found user DN — validates their password.
//  5. Extract email + display_name attributes.
//  6. Find or auto-provision local IronStock user.
//  7. Issue session + tokens.
func (s *AuthHandlers) LDAPLogin(w http.ResponseWriter, r *http.Request) {
	var req ldapLoginRequest
	if !decodeJSON(w, r, s.Logger, &req) {
		return
	}
	if req.ProviderID == "" || req.Username == "" || req.Password == "" {
		writeError(w, s.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"provider_id, username ve password zorunlu.", errors.New("missing fields"))
		return
	}

	ctx := r.Context()

	p, err := fetchSSOProvider(ctx, s.Service.DB, req.ProviderID)
	if err != nil || p.ProviderType != "ldap" {
		writeError(w, s.Logger, http.StatusNotFound, ErrCodeNotFound,
			"LDAP sağlayıcısı bulunamadı.", err)
		return
	}
	if p.LDAPUrl == nil || p.LDAPUserSearchBase == nil {
		writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"LDAP yapılandırması eksik (ldap_url veya search_base).", errors.New("nil"))
		return
	}

	// Decrypt service-account bind password.
	var bindPassword string
	if len(p.LDAPBindPasswordEnc) > 0 {
		aad := crypto.MakeAAD("sso_providers", p.ID, "ldap_bind_password_enc")
		plain, decErr := s.Service.Master.Open(p.LDAPBindPasswordEnc, aad)
		if decErr != nil {
			writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"LDAP servis şifresi çözülemedi.", decErr)
			return
		}
		bindPassword = string(plain)
	}

	// Connect.
	conn, connErr := ldapDial(*p.LDAPUrl, p.LDAPSkipTLSVerify)
	if connErr != nil {
		writeError(w, s.Logger, http.StatusBadGateway, ErrCodeInternal,
			"LDAP sunucusuna bağlanılamadı.", connErr)
		return
	}
	defer conn.Close()

	// StartTLS upgrade (optional).
	if p.LDAPUseStartTLS {
		tlsCfg := &tls.Config{InsecureSkipVerify: p.LDAPSkipTLSVerify} //nolint:gosec
		if tlsErr := conn.StartTLS(tlsCfg); tlsErr != nil {
			writeError(w, s.Logger, http.StatusBadGateway, ErrCodeInternal,
				"StartTLS başlatılamadı.", tlsErr)
			return
		}
	}

	// Bind as service account (anonymous if no bindDN configured).
	if p.LDAPBindDN != nil && *p.LDAPBindDN != "" {
		if bindErr := conn.Bind(*p.LDAPBindDN, bindPassword); bindErr != nil {
			writeError(w, s.Logger, http.StatusBadGateway, ErrCodeInternal,
				"LDAP servis hesabı bağlanamadı.", bindErr)
			return
		}
	}

	// Search for the user.
	filter := strings.ReplaceAll(p.LDAPUserFilter, "{username}", ldap.EscapeFilter(req.Username))
	searchReq := ldap.NewSearchRequest(
		*p.LDAPUserSearchBase,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 30, false,
		filter,
		[]string{"dn", p.LDAPAttrUsername, p.LDAPAttrEmail, p.LDAPAttrDisplayName},
		nil,
	)
	result, searchErr := conn.Search(searchReq)
	if searchErr != nil || len(result.Entries) == 0 {
		s.recordLoginFail(ctx, r, "", "ldap_user_not_found")
		writeInvalidCreds(w, s.Logger, fmt.Errorf("ldap search: %w", searchErr))
		return
	}

	entry := result.Entries[0]
	externalID := entry.GetAttributeValue(p.LDAPAttrUsername)
	if externalID == "" {
		externalID = req.Username
	}
	email := entry.GetAttributeValue(p.LDAPAttrEmail)
	displayName := entry.GetAttributeValue(p.LDAPAttrDisplayName)

	// Bind as user — validates their password.
	if userBindErr := conn.Bind(entry.DN, req.Password); userBindErr != nil {
		s.recordLoginFail(ctx, r, "", "ldap_wrong_password")
		writeInvalidCreds(w, s.Logger, fmt.Errorf("ldap user bind: %w", userBindErr))
		return
	}

	// LDAP credentials verified. Find or provision local user.
	userID, provErr := findOrProvisionSSOUser(ctx, s.Service.DB, p, externalID, email, displayName)
	if provErr != nil {
		writeError(w, s.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Kullanıcı bulunamadı veya otomatik oluşturulamadı: "+provErr.Error(), provErr)
		return
	}

	s.issueSessionForSSO(ctx, w, r, userID, p.Name)
}

// ldapDial opens a TCP or TLS connection to the given LDAP URL.
func ldapDial(ldapURL string, skipVerify bool) (*ldap.Conn, error) {
	u, parseErr := url.Parse(ldapURL)
	if parseErr != nil {
		return nil, fmt.Errorf("invalid ldap_url: %w", parseErr)
	}
	if u.Scheme == "ldaps" {
		tlsCfg := &tls.Config{
			InsecureSkipVerify: skipVerify, //nolint:gosec
			ServerName:         u.Hostname(),
		}
		return ldap.DialURL(ldapURL, ldap.DialWithTLSConfig(tlsCfg))
	}
	return ldap.DialURL(ldapURL)
}

// ─────────────────────────────────────────────
//  OIDC — authorize redirect
//  GET /api/v1/auth/sso/{provider_id}/authorize
// ─────────────────────────────────────────────

// OIDCAuthorize builds the authorization URL and redirects the browser to
// the OIDC provider's login page.
func (s *AuthHandlers) OIDCAuthorize(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "provider_id")
	ctx := r.Context()

	p, err := fetchSSOProvider(ctx, s.Service.DB, providerID)
	if err != nil || p.ProviderType != "oidc" {
		http.Error(w, "OIDC sağlayıcısı bulunamadı", http.StatusNotFound)
		return
	}
	if p.DiscoveryURL == nil || p.ClientID == nil {
		http.Error(w, "OIDC yapılandırması eksik", http.StatusInternalServerError)
		return
	}

	disc, err := fetchOIDCDiscovery(ctx, *p.DiscoveryURL)
	if err != nil {
		http.Error(w, "OIDC discovery başarısız: "+err.Error(), http.StatusBadGateway)
		return
	}

	// PKCE code verifier + challenge.
	verifier, challenge, err := generatePKCE()
	if err != nil {
		http.Error(w, "PKCE üretilemedi", http.StatusInternalServerError)
		return
	}

	state := issueOIDCState(providerID, verifier)
	redirectURI := buildSSORedirectURI(r, providerID)

	scopes := strings.Join(p.Scopes, " ")
	if scopes == "" {
		scopes = "openid email profile"
	}

	authURL := disc.AuthorizationEndpoint +
		"?response_type=code" +
		"&client_id=" + url.QueryEscape(*p.ClientID) +
		"&redirect_uri=" + url.QueryEscape(redirectURI) +
		"&scope=" + url.QueryEscape(scopes) +
		"&state=" + url.QueryEscape(state) +
		"&code_challenge=" + url.QueryEscape(challenge) +
		"&code_challenge_method=S256"

	http.Redirect(w, r, authURL, http.StatusFound)
}

// ─────────────────────────────────────────────
//  OIDC — callback
//  GET /api/v1/auth/sso/{provider_id}/callback
// ─────────────────────────────────────────────

// OIDCCallback handles the provider redirect after user authentication,
// exchanges the code for an ID token, finds/provisions the user, and
// redirects the browser to the frontend /sso-callback page with tokens
// in the URL hash fragment (hash is not sent to servers in Referer).
func (s *AuthHandlers) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "provider_id")
	ctx := r.Context()

	// Validate + consume state.
	state := r.URL.Query().Get("state")
	entry, ok := consumeOIDCState(state)
	if !ok || entry.ProviderID != providerID {
		http.Error(w, "Geçersiz veya süresi dolmuş SSO oturumu. Lütfen tekrar deneyin.", http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		// Provider may have sent an error (e.g., user cancelled).
		providerErr := r.URL.Query().Get("error")
		http.Error(w, "Yetkilendirme kodu eksik: "+providerErr, http.StatusBadRequest)
		return
	}

	p, err := fetchSSOProvider(ctx, s.Service.DB, providerID)
	if err != nil || p.ProviderType != "oidc" {
		http.Error(w, "OIDC sağlayıcısı bulunamadı", http.StatusNotFound)
		return
	}
	if p.DiscoveryURL == nil || p.ClientID == nil {
		http.Error(w, "OIDC yapılandırması eksik", http.StatusInternalServerError)
		return
	}

	// Decrypt client secret.
	var clientSecret string
	if len(p.ClientSecretEnc) > 0 {
		aad := crypto.MakeAAD("sso_providers", p.ID, "client_secret_enc")
		plain, decErr := s.Service.Master.Open(p.ClientSecretEnc, aad)
		if decErr != nil {
			http.Error(w, "Client secret çözülemedi", http.StatusInternalServerError)
			return
		}
		clientSecret = string(plain)
	}

	disc, err := fetchOIDCDiscovery(ctx, *p.DiscoveryURL)
	if err != nil {
		http.Error(w, "OIDC discovery başarısız: "+err.Error(), http.StatusBadGateway)
		return
	}

	redirectURI := buildSSORedirectURI(r, providerID)

	// Exchange code for ID token.
	idTokenStr, err := exchangeOIDCCode(ctx, disc.TokenEndpoint,
		*p.ClientID, clientSecret, code, redirectURI, entry.PKCEVerifier)
	if err != nil {
		http.Error(w, "Token exchange başarısız: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Parse claims from ID token payload.
	claims, err := parseIDTokenClaims(idTokenStr)
	if err != nil {
		http.Error(w, "ID token ayrıştırılamadı: "+err.Error(), http.StatusBadGateway)
		return
	}

	displayName := claims.Name
	if displayName == "" {
		displayName = claims.PreferredUsername
	}

	userID, provErr := findOrProvisionSSOUser(ctx, s.Service.DB, p,
		claims.Sub, claims.Email, displayName)
	if provErr != nil {
		http.Error(w, "Kullanıcı oluşturulamadı: "+provErr.Error(), http.StatusForbidden)
		return
	}

	// Create session.
	var status, username string
	var mustChangePwd bool
	if err := s.Service.DB.QueryRow(ctx,
		`SELECT status, must_change_password, username FROM users WHERE id = $1::uuid`, userID,
	).Scan(&status, &mustChangePwd, &username); err != nil || status == "disabled" {
		http.Error(w, "Hesap erişilemez", http.StatusForbidden)
		return
	}

	refresh, err := auth.GenerateRefresh()
	if err != nil {
		http.Error(w, "Refresh token üretilemedi", http.StatusInternalServerError)
		return
	}
	tx, err := s.Service.DB.Begin(ctx)
	if err != nil {
		http.Error(w, "DB hatası", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := recordLoginSuccess(ctx, tx, userID); err != nil {
		http.Error(w, "Login durumu güncellenemedi", http.StatusInternalServerError)
		return
	}
	sessionID, err := auth.CreateSession(ctx, tx, userID, refresh.Hash,
		r.UserAgent(), parseIP(r.RemoteAddr), refresh.ExpiresAt)
	if err != nil {
		http.Error(w, "Oturum oluşturulamadı", http.StatusInternalServerError)
		return
	}
	roles, err := fetchUserRoles(ctx, tx, userID)
	if err != nil {
		http.Error(w, "Roller okunamadı", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "İşlem tamamlanamadı", http.StatusInternalServerError)
		return
	}
	accessToken, err := s.Service.JWT.IssueAccess(userID, sessionID, roles)
	if err != nil {
		http.Error(w, "Access token üretilemedi", http.StatusInternalServerError)
		return
	}

	_ = s.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       audit.ActionAuthLogin,
		ResourceType: audit.ResourceSession,
		ResourceID:   sessionID,
		Details:      map[string]any{"via": "oidc", "provider": p.Name},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	rolesJSON, _ := json.Marshal(roles)
	frontendURL := buildFrontendURL(r) + "/sso-callback#" +
		"access_token=" + url.QueryEscape(accessToken) +
		"&refresh_token=" + url.QueryEscape(refresh.Token) +
		"&user_id=" + url.QueryEscape(userID) +
		"&username=" + url.QueryEscape(username) +
		"&roles=" + url.QueryEscape(string(rolesJSON)) +
		"&expires_in=" + fmt.Sprintf("%d", int(auth.AccessTokenLifetime.Seconds()))

	http.Redirect(w, r, frontendURL, http.StatusFound)
}

// ─────────────────────────────────────────────
//  OIDC helpers
// ─────────────────────────────────────────────

type oidcDiscovery struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
}

func fetchOIDCDiscovery(ctx context.Context, discoveryURL string) (oidcDiscovery, error) {
	base := strings.TrimRight(discoveryURL, "/")
	var docURL string
	if strings.HasSuffix(base, "openid-configuration") {
		docURL = base
	} else {
		docURL = base + "/.well-known/openid-configuration"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, docURL, nil)
	if err != nil {
		return oidcDiscovery{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return oidcDiscovery{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	var doc oidcDiscovery
	if err := json.Unmarshal(body, &doc); err != nil {
		return oidcDiscovery{}, fmt.Errorf("parse discovery: %w", err)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" {
		return oidcDiscovery{}, errors.New("discovery doc missing required endpoints")
	}
	return doc, nil
}

type idTokenClaims struct {
	Sub               string `json:"sub"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
}

// exchangeOIDCCode posts the authorization code to the token endpoint and
// returns the raw id_token JWT string.
func exchangeOIDCCode(ctx context.Context, tokenEndpoint, clientID, clientSecret,
	code, redirectURI, codeVerifier string) (string, error) {

	vals := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {clientID},
		"code_verifier": {codeVerifier},
	}
	if clientSecret != "" {
		vals.Set("client_secret", clientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint,
		strings.NewReader(vals.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	var tokenResp struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("parse token response: %w", err)
	}
	if tokenResp.Error != "" {
		return "", fmt.Errorf("token endpoint error: %s", tokenResp.Error)
	}
	if tokenResp.IDToken == "" {
		return "", errors.New("token endpoint did not return id_token")
	}
	return tokenResp.IDToken, nil
}

// parseIDTokenClaims extracts JWT payload claims WITHOUT verifying the signature.
// This is safe here because the token was obtained directly from the OIDC provider's
// token endpoint over a TLS-authenticated HTTPS connection.
// Full JWKS signature verification can be added in a follow-up PR.
func parseIDTokenClaims(idToken string) (idTokenClaims, error) {
	parts := strings.SplitN(idToken, ".", 3)
	if len(parts) != 3 {
		return idTokenClaims{}, errors.New("invalid JWT format")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("decode JWT payload: %w", err)
	}
	var claims idTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return idTokenClaims{}, fmt.Errorf("parse JWT claims: %w", err)
	}
	if claims.Sub == "" {
		return idTokenClaims{}, errors.New("JWT missing 'sub' claim")
	}
	return claims, nil
}

// generatePKCE creates a PKCE code_verifier and the S256 code_challenge.
func generatePKCE() (verifier, challenge string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(h[:])
	return
}

// buildSSORedirectURI returns the OIDC callback URL registered with the provider.
func buildSSORedirectURI(r *http.Request, providerID string) string {
	return buildFrontendURL(r) + "/api/v1/auth/sso/" + providerID + "/callback"
}

// buildFrontendURL returns the scheme+host portion of the current request URL.
func buildFrontendURL(r *http.Request) string {
	scheme := "https"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS == nil {
		scheme = "http"
	}
	host := r.Host
	if fwdHost := r.Header.Get("X-Forwarded-Host"); fwdHost != "" {
		host = fwdHost
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}
