package httpapi

// PR-VAULT: Vault proxy handlers (ADR-0007).
//
// Endpoints:
//   POST /api/v1/items/{id}/vault-fetch — fetch Vault-backed field values
//   GET  /api/v1/vault/paths           — list Vault paths (admin only, autocomplete)
//
// Security model:
//   - Vault plaintext is NEVER stored in DB or logged. Server is a pass-through proxy.
//   - Every fetch is audit-logged with metadata (path, success) but NOT with values.
//   - Caller must have item Read permission (or admin) for vault-fetch.
//   - Path listing is admin-only to avoid leaking Vault structure to regular users.

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/vault"
)

// isCleanVaultPath rejects path traversal sequences and suspicious characters.
func isCleanVaultPath(p string) bool {
	if strings.Contains(p, "..") || strings.Contains(p, "//") || strings.HasPrefix(p, "/") {
		return false
	}
	for _, r := range p {
		if r < 0x20 || r == '\\' {
			return false
		}
	}
	return true
}

// VaultHandlers groups the vault proxy HTTP handlers.
type VaultHandlers struct {
	Service *auth.Service
	Vault   *vault.Client // nil when Vault is not configured
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// vaultFetchResponse is the body returned by POST /api/v1/items/{id}/vault-fetch.
type vaultFetchResponse struct {
	Fields []vaultFieldValue `json:"fields"`
}

// vaultFieldValue pairs a field_definition.key with a plaintext value from Vault.
// This value is ephemeral — client should zero memory after use.
type vaultFieldValue struct {
	FieldKey string `json:"field_key"` // matches field_definitions.key, e.g. "password"
	Value    string `json:"value"`     // plaintext — NEVER logged
}

// vaultPathsResponse is the body returned by GET /api/v1/vault/paths.
type vaultPathsResponse struct {
	Paths []string `json:"paths"`
}

// VaultFetch implements POST /api/v1/items/{id}/vault-fetch.
//
// Fetches Vault-backed field values for an item. The item must have
// external_source.type = "vault". Values are returned as plaintext in-memory
// and never persisted. Every call is audit-logged.
func (h *VaultHandlers) VaultFetch(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item id zorunlu.", errors.New("missing id"))
		return
	}

	if vault.IsNil(h.Vault) {
		writeError(w, h.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Vault entegrasyonu yapılandırılmamış.", vault.ErrVaultDisabled)
		return
	}

	ctx := r.Context()

	// 1. Resolve item permission (admin or read+).
	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item için okuma yetkisi gerekli.", errors.New("read denied"))
			return
		}
	}

	// 2. Load external_source from DB.
	var rawExtSrc []byte
	err := h.Service.DB.QueryRow(ctx,
		`SELECT external_source FROM items WHERE id = $1::uuid LIMIT 1`,
		itemID,
	).Scan(&rawExtSrc)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı.", err)
		return
	}
	if rawExtSrc == nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest,
			"Bu item Vault-backed değil (external_source boş).", errors.New("no external_source"))
		return
	}

	var src vault.ExternalSourceVault
	if err := json.Unmarshal(rawExtSrc, &src); err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest,
			"external_source parse edilemedi.", err)
		return
	}
	if src.Type != "vault" {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest,
			"external_source.type 'vault' değil.", errors.New("unsupported source type"))
		return
	}
	if src.Mount == "" || src.Path == "" {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest,
			"external_source.mount ve path zorunlu.", errors.New("missing mount/path"))
		return
	}
	if !isCleanVaultPath(src.Mount) || !isCleanVaultPath(src.Path) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"mount veya path geçersiz karakter içeriyor.", errors.New("path traversal attempt"))
		return
	}

	// 3. Fetch from Vault.
	kvData, fetchErr := h.Vault.ReadKV(ctx, src)

	// 4. Audit — always, success or failure. Plaintext values are NEVER included.
	if fetchErr != nil {
		_ = h.Audit.Write(ctx, audit.Entry{
			ActorUserID:  claims.Subject,
			Action:       audit.ActionItemVaultFetchError,
			ResourceType: audit.ResourceItem,
			ResourceID:   itemID,
			Details: map[string]any{
				"vault_mount": src.Mount,
				"vault_path":  src.Path,
				"error":       fetchErr.Error(),
			},
			IPAddress: parseIP(r.RemoteAddr),
			UserAgent: r.UserAgent(),
		})
		if errors.Is(fetchErr, vault.ErrSecretNotFound) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Vault secret bulunamadı.", fetchErr)
			return
		}
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal,
			"Vault'tan secret alınamadı.", fetchErr)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemVaultFetch,
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details: map[string]any{
			"vault_mount":  src.Mount,
			"vault_path":   src.Path,
			"fields_count": len(kvData),
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	// 5. Build response — only mapped field_keys that exist in Vault data.
	out := make([]vaultFieldValue, 0, len(kvData))
	for fieldKey, value := range kvData {
		out = append(out, vaultFieldValue{FieldKey: fieldKey, Value: value})
	}

	writeJSON(w, http.StatusOK, vaultFetchResponse{Fields: out})
}

// VaultListPaths implements GET /api/v1/vault/paths?mount=secret&path=.
//
// Returns available Vault paths at the given prefix for item-form autocomplete.
// Admin-only: listing Vault structure should not be exposed to regular users.
func (h *VaultHandlers) VaultListPaths(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	if !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
			"Vault path listesi admin yetkisi gerektirir.", errors.New("admin required"))
		return
	}

	if vault.IsNil(h.Vault) {
		writeError(w, h.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Vault entegrasyonu yapılandırılmamış.", vault.ErrVaultDisabled)
		return
	}

	mount := r.URL.Query().Get("mount")
	if mount == "" {
		mount = "secret"
	}
	prefix := r.URL.Query().Get("path")
	if !isCleanVaultPath(mount) || (prefix != "" && !isCleanVaultPath(prefix)) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"mount veya path geçersiz karakter içeriyor.", errors.New("path traversal attempt"))
		return
	}

	paths, err := h.Vault.ListPaths(r.Context(), mount, prefix)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal,
			"Vault path listesi alınamadı.", err)
		return
	}
	if paths == nil {
		paths = []string{}
	}
	writeJSON(w, http.StatusOK, vaultPathsResponse{Paths: paths})
}
