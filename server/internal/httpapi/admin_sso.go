package httpapi

// PR-LDAP: Admin endpoints for SSO provider CRUD.
//
// All routes require admin role (enforced by RequireRole middleware in router).
//
// Secrets (client_secret, ldap_bind_password) are encrypted with the master key
// via crypto.Seal before storage and never returned in plain text through the API.

import (
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// SSOHandlers groups admin SSO provider management endpoints.
type SSOHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// ssoProviderPublic is the API representation of a provider (secrets omitted).
type ssoProviderPublic struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	ProviderType        string    `json:"provider_type"`
	Enabled             bool      `json:"enabled"`
	DiscoveryURL        *string   `json:"discovery_url,omitempty"`
	ClientID            *string   `json:"client_id,omitempty"`
	HasClientSecret     bool      `json:"has_client_secret"`
	Scopes              []string  `json:"scopes,omitempty"`
	LDAPUrl             *string   `json:"ldap_url,omitempty"`
	LDAPBindDN          *string   `json:"ldap_bind_dn,omitempty"`
	HasLDAPBindPassword bool      `json:"has_ldap_bind_password"`
	LDAPUserSearchBase  *string   `json:"ldap_user_search_base,omitempty"`
	LDAPUserFilter      string    `json:"ldap_user_filter,omitempty"`
	LDAPAttrUsername    string    `json:"ldap_attr_username,omitempty"`
	LDAPAttrEmail       string    `json:"ldap_attr_email,omitempty"`
	LDAPAttrDisplayName string    `json:"ldap_attr_display_name,omitempty"`
	LDAPUseStartTLS     bool      `json:"ldap_use_starttls"`
	LDAPSkipTLSVerify   bool      `json:"ldap_skip_tls_verify"`
	AutoProvision       bool      `json:"auto_provision"`
	DefaultRole         string    `json:"default_role"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// ListSSOProviders implements GET /api/v1/admin/sso/providers.
func (h *SSOHandlers) ListSSOProviders(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Service.DB.Query(ctx, `
		SELECT id::text, name, provider_type, enabled,
		       discovery_url, client_id,
		       (client_secret_enc IS NOT NULL AND length(client_secret_enc) > 0) AS has_client_secret,
		       scopes,
		       ldap_url, ldap_bind_dn,
		       (ldap_bind_password_enc IS NOT NULL AND length(ldap_bind_password_enc) > 0) AS has_ldap_bind_password,
		       ldap_user_search_base, ldap_user_filter,
		       ldap_attr_username, ldap_attr_email, ldap_attr_display_name,
		       ldap_use_starttls, ldap_skip_tls_verify,
		       auto_provision, default_role, created_at, updated_at
		FROM sso_providers
		ORDER BY name
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"SSO sağlayıcıları listelenemedi.", err)
		return
	}
	defer rows.Close()

	providers := []ssoProviderPublic{}
	for rows.Next() {
		var p ssoProviderPublic
		if err := rows.Scan(
			&p.ID, &p.Name, &p.ProviderType, &p.Enabled,
			&p.DiscoveryURL, &p.ClientID, &p.HasClientSecret, &p.Scopes,
			&p.LDAPUrl, &p.LDAPBindDN, &p.HasLDAPBindPassword, &p.LDAPUserSearchBase,
			&p.LDAPUserFilter, &p.LDAPAttrUsername, &p.LDAPAttrEmail, &p.LDAPAttrDisplayName,
			&p.LDAPUseStartTLS, &p.LDAPSkipTLSVerify,
			&p.AutoProvision, &p.DefaultRole, &p.CreatedAt, &p.UpdatedAt,
		); err == nil {
			providers = append(providers, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": providers})
}

// createSSOProviderRequest is the body for POST /api/v1/admin/sso/providers.
type createSSOProviderRequest struct {
	Name          string   `json:"name"`
	ProviderType  string   `json:"provider_type"`
	Enabled       bool     `json:"enabled"`
	AutoProvision bool     `json:"auto_provision"`
	DefaultRole   string   `json:"default_role"`

	// OIDC
	DiscoveryURL string   `json:"discovery_url"`
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"` //nolint:tagliatelle
	Scopes       []string `json:"scopes"`

	// LDAP
	LDAPUrl             string `json:"ldap_url"`
	LDAPBindDN          string `json:"ldap_bind_dn"`
	LDAPBindPassword    string `json:"ldap_bind_password"` //nolint:tagliatelle
	LDAPUserSearchBase  string `json:"ldap_user_search_base"`
	LDAPUserFilter      string `json:"ldap_user_filter"`
	LDAPAttrUsername    string `json:"ldap_attr_username"`
	LDAPAttrEmail       string `json:"ldap_attr_email"`
	LDAPAttrDisplayName string `json:"ldap_attr_display_name"`
	LDAPUseStartTLS     bool   `json:"ldap_use_starttls"`
	LDAPSkipTLSVerify   bool   `json:"ldap_skip_tls_verify"`
}

// CreateSSOProvider implements POST /api/v1/admin/sso/providers.
func (h *SSOHandlers) CreateSSOProvider(w http.ResponseWriter, r *http.Request) {
	var req createSSOProviderRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name zorunlu.", errors.New("missing name"))
		return
	}
	if req.ProviderType != "oidc" && req.ProviderType != "ldap" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"provider_type 'oidc' veya 'ldap' olmalı.", errors.New("invalid provider_type"))
		return
	}
	// Apply defaults.
	if req.DefaultRole == "" {
		req.DefaultRole = "read"
	}
	if len(req.Scopes) == 0 && req.ProviderType == "oidc" {
		req.Scopes = []string{"openid", "email", "profile"}
	}
	if req.LDAPUserFilter == "" {
		req.LDAPUserFilter = "(uid={username})"
	}
	if req.LDAPAttrUsername == "" {
		req.LDAPAttrUsername = "uid"
	}
	if req.LDAPAttrEmail == "" {
		req.LDAPAttrEmail = "mail"
	}
	if req.LDAPAttrDisplayName == "" {
		req.LDAPAttrDisplayName = "cn"
	}

	ctx := r.Context()
	claims, _ := ClaimsFromContext(ctx)

	// Insert without secrets first to get the real ID for AAD.
	var newID string
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO sso_providers (
			name, provider_type, enabled, auto_provision, default_role,
			discovery_url, client_id, scopes,
			ldap_url, ldap_bind_dn,
			ldap_user_search_base, ldap_user_filter,
			ldap_attr_username, ldap_attr_email, ldap_attr_display_name,
			ldap_use_starttls, ldap_skip_tls_verify,
			created_by
		) VALUES (
			$1, $2, $3, $4, $5,
			NULLIF($6,''), NULLIF($7,''), $8,
			NULLIF($9,''), NULLIF($10,''),
			NULLIF($11,''), $12,
			$13, $14, $15, $16, $17,
			$18::uuid
		)
		RETURNING id::text
	`,
		req.Name, req.ProviderType, req.Enabled, req.AutoProvision, req.DefaultRole,
		req.DiscoveryURL, req.ClientID, req.Scopes,
		req.LDAPUrl, req.LDAPBindDN,
		req.LDAPUserSearchBase, req.LDAPUserFilter,
		req.LDAPAttrUsername, req.LDAPAttrEmail, req.LDAPAttrDisplayName,
		req.LDAPUseStartTLS, req.LDAPSkipTLSVerify,
		nullableStr(claims.Subject),
	).Scan(&newID)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu isimde bir SSO sağlayıcısı zaten var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"SSO sağlayıcısı oluşturulamadı.", err)
		return
	}

	// Encrypt secrets now that we have the real ID for proper AAD binding.
	if req.ClientSecret != "" {
		aad := crypto.MakeAAD("sso_providers", newID, "client_secret_enc")
		enc, encErr := h.Service.Master.Seal([]byte(req.ClientSecret), aad)
		if encErr == nil {
			_, _ = h.Service.DB.Exec(ctx,
				`UPDATE sso_providers SET client_secret_enc=$2 WHERE id=$1::uuid`, newID, enc)
		}
	}
	if req.LDAPBindPassword != "" {
		aad := crypto.MakeAAD("sso_providers", newID, "ldap_bind_password_enc")
		enc, encErr := h.Service.Master.Seal([]byte(req.LDAPBindPassword), aad)
		if encErr == nil {
			_, _ = h.Service.DB.Exec(ctx,
				`UPDATE sso_providers SET ldap_bind_password_enc=$2 WHERE id=$1::uuid`, newID, enc)
		}
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminSSOProviderCreated,
		ResourceType: "sso_provider",
		ResourceID:   newID,
		Details:      map[string]any{"name": req.Name, "type": req.ProviderType},
	})

	writeJSON(w, http.StatusCreated, map[string]any{"id": newID})
}

// UpdateSSOProvider implements PUT /api/v1/admin/sso/providers/{id}.
func (h *SSOHandlers) UpdateSSOProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req createSSOProviderRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}

	ctx := r.Context()
	claims, _ := ClaimsFromContext(ctx)

	tag, err := h.Service.DB.Exec(ctx, `
		UPDATE sso_providers SET
			name = $2, enabled = $3, auto_provision = $4, default_role = $5,
			discovery_url = NULLIF($6,''), client_id = NULLIF($7,''),
			scopes = $8,
			ldap_url = NULLIF($9,''), ldap_bind_dn = NULLIF($10,''),
			ldap_user_search_base = NULLIF($11,''), ldap_user_filter = $12,
			ldap_attr_username = $13, ldap_attr_email = $14, ldap_attr_display_name = $15,
			ldap_use_starttls = $16, ldap_skip_tls_verify = $17,
			updated_at = NOW()
		WHERE id = $1::uuid
	`,
		id, req.Name, req.Enabled, req.AutoProvision, req.DefaultRole,
		req.DiscoveryURL, req.ClientID, req.Scopes,
		req.LDAPUrl, req.LDAPBindDN,
		req.LDAPUserSearchBase, req.LDAPUserFilter,
		req.LDAPAttrUsername, req.LDAPAttrEmail, req.LDAPAttrDisplayName,
		req.LDAPUseStartTLS, req.LDAPSkipTLSVerify,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"SSO sağlayıcısı güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"SSO sağlayıcısı bulunamadı.", errors.New("not found"))
		return
	}

	// Re-encrypt secrets if new values were provided.
	if req.ClientSecret != "" {
		aad := crypto.MakeAAD("sso_providers", id, "client_secret_enc")
		if enc, encErr := h.Service.Master.Seal([]byte(req.ClientSecret), aad); encErr == nil {
			_, _ = h.Service.DB.Exec(ctx,
				`UPDATE sso_providers SET client_secret_enc=$2 WHERE id=$1::uuid`, id, enc)
		}
	}
	if req.LDAPBindPassword != "" {
		aad := crypto.MakeAAD("sso_providers", id, "ldap_bind_password_enc")
		if enc, encErr := h.Service.Master.Seal([]byte(req.LDAPBindPassword), aad); encErr == nil {
			_, _ = h.Service.DB.Exec(ctx,
				`UPDATE sso_providers SET ldap_bind_password_enc=$2 WHERE id=$1::uuid`, id, enc)
		}
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminSSOProviderUpdated,
		ResourceType: "sso_provider",
		ResourceID:   id,
		Details:      map[string]any{"name": req.Name},
	})

	w.WriteHeader(http.StatusNoContent)
}

// DeleteSSOProvider implements DELETE /api/v1/admin/sso/providers/{id}.
func (h *SSOHandlers) DeleteSSOProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	claims, _ := ClaimsFromContext(ctx)

	var name string
	if err := h.Service.DB.QueryRow(ctx,
		`SELECT name FROM sso_providers WHERE id = $1::uuid`, id,
	).Scan(&name); err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"SSO sağlayıcısı bulunamadı.", err)
		return
	}

	if _, err := h.Service.DB.Exec(ctx,
		`DELETE FROM sso_providers WHERE id = $1::uuid`, id,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"SSO sağlayıcısı silinemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionAdminSSOProviderDeleted,
		ResourceType: "sso_provider",
		ResourceID:   id,
		Details:      map[string]any{"name": name},
	})

	w.WriteHeader(http.StatusNoContent)
}

// TestLDAPConnection implements POST /api/v1/admin/sso/providers/{id}/test.
// Attempts to connect and bind as the service account. LDAP providers only.
func (h *SSOHandlers) TestLDAPConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	// Fetch provider without the enabled filter (admin may test disabled ones).
	var p ssoProviderRow
	err := h.Service.DB.QueryRow(ctx, `
		SELECT id::text, name, provider_type, enabled,
		       discovery_url, client_id, client_secret_enc, scopes,
		       ldap_url, ldap_bind_dn, ldap_bind_password_enc,
		       ldap_user_search_base, ldap_user_filter,
		       ldap_attr_username, ldap_attr_email, ldap_attr_display_name,
		       ldap_use_starttls, ldap_skip_tls_verify,
		       auto_provision, default_role
		FROM sso_providers WHERE id = $1::uuid
	`, id).Scan(
		&p.ID, &p.Name, &p.ProviderType, &p.Enabled,
		&p.DiscoveryURL, &p.ClientID, &p.ClientSecretEnc, &p.Scopes,
		&p.LDAPUrl, &p.LDAPBindDN, &p.LDAPBindPasswordEnc,
		&p.LDAPUserSearchBase, &p.LDAPUserFilter,
		&p.LDAPAttrUsername, &p.LDAPAttrEmail, &p.LDAPAttrDisplayName,
		&p.LDAPUseStartTLS, &p.LDAPSkipTLSVerify,
		&p.AutoProvision, &p.DefaultRole,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Sağlayıcı bulunamadı.", err)
		return
	}
	if p.ProviderType != "ldap" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Test yalnızca LDAP sağlayıcıları için destekleniyor.", errors.New("not ldap"))
		return
	}
	if p.LDAPUrl == nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"ldap_url yapılandırılmamış.", errors.New("nil url"))
		return
	}

	// Decrypt bind password.
	var bindPassword string
	if len(p.LDAPBindPasswordEnc) > 0 {
		aad := crypto.MakeAAD("sso_providers", p.ID, "ldap_bind_password_enc")
		plain, decErr := h.Service.Master.Open(p.LDAPBindPasswordEnc, aad)
		if decErr != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"LDAP bind şifresi çözülemedi.", decErr)
			return
		}
		bindPassword = string(plain)
	}

	conn, dialErr := ldapDial(*p.LDAPUrl, p.LDAPSkipTLSVerify)
	if dialErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": "Bağlantı hatası: " + dialErr.Error(),
		})
		return
	}
	defer conn.Close()

	if p.LDAPUseStartTLS {
		tlsCfg := &tls.Config{InsecureSkipVerify: p.LDAPSkipTLSVerify} //nolint:gosec
		if tlsErr := conn.StartTLS(tlsCfg); tlsErr != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "StartTLS hatası: " + tlsErr.Error(),
			})
			return
		}
	}

	if p.LDAPBindDN != nil && *p.LDAPBindDN != "" {
		if bindErr := conn.Bind(*p.LDAPBindDN, bindPassword); bindErr != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "Servis hesabı bağlanamadı: " + bindErr.Error(),
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "LDAP bağlantısı başarılı.",
	})
}

// nullableStr returns nil if s is empty (maps to SQL NULL), else &s.
func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
