package httpapi

// vault_dynamic.go — PR-VAULT-DYN: Dynamic Vault secret endpoints.
//
// Endpoints:
//   POST   /api/v1/items/{id}/dynamic-cred           — issue ephemeral credential
//   DELETE /api/v1/items/{id}/dynamic-cred/{lease_id} — revoke lease early
//
// Security model:
//   - Vault plaintext (username + password) is NEVER stored or logged.
//   - The server acts as a pass-through: fetch from Vault → return to client.
//   - Caller must have item Read permission (or admin).
//   - Every issuance and revocation is audit-logged (no secret material in audit).
//
// E2E note: unlike static Vault KV secrets, dynamic creds are returned plaintext
// by design — they are ephemeral and carry no long-term value. The client UI
// should clear them from memory/clipboard after the lease expires.

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/vault"
)

// IssueDynamicCred implements POST /api/v1/items/{id}/dynamic-cred.
//
// Requires the item's external_source.dynamic = true and a configured
// Vault client. Issues a new ephemeral credential from the dynamic secrets
// engine and returns it directly to the caller. Nothing is stored server-side.
func (h *VaultHandlers) IssueDynamicCred(w http.ResponseWriter, r *http.Request) {
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
	userID := claims.Subject

	// 1. Resolve item read permission.
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Bu item'a erişim yetkisi yok.", nil)
			return
		}
	}

	// 2. Load item external_source.
	var rawSource []byte
	err := h.Service.DB.QueryRow(ctx,
		`SELECT external_source FROM items WHERE id = $1::uuid`, itemID,
	).Scan(&rawSource)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Item bulunamadı.", err)
		return
	}
	if rawSource == nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Bu item bir Vault entegrasyonu içermiyor.", nil)
		return
	}

	var src vault.ExternalSourceVault
	if err := json.Unmarshal(rawSource, &src); err != nil || src.Type != "vault" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Item Vault entegrasyonu geçersiz.", err)
		return
	}
	if !src.Dynamic {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Bu item dinamik credential desteği içermiyor (dynamic=false).", nil)
		return
	}
	if src.Mount == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Vault mount alanı boş.", nil)
		return
	}

	// 3. Issue dynamic credential from Vault.
	cred, err := h.Vault.IssueDynamicCred(ctx, src.Mount, src.TTL)
	if err != nil {
		h.Logger.Warn("vault: dynamic cred issue failed",
			"item_id", itemID,
			"mount", src.Mount,
			"error", err.Error(),
		)
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal,
			"Vault'tan dinamik credential alınamadı.", err)
		return
	}

	// 4. Audit — no secret material.
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "item.dynamic_cred_issued",
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details: map[string]any{
			"mount":          src.Mount,
			"lease_id":       cred.LeaseID,
			"lease_duration": cred.LeaseDuration,
		},
	})

	writeJSON(w, http.StatusOK, cred)
}

// RevokeDynamicCred implements DELETE /api/v1/items/{id}/dynamic-cred/{lease_id}.
//
// Revokes a Vault lease early. Best-effort: 204 is returned even if revocation
// fails (e.g. already-expired lease). An audit entry is always written.
func (h *VaultHandlers) RevokeDynamicCred(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	leaseID := chi.URLParam(r, "lease_id")
	if itemID == "" || leaseID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item id ve lease_id zorunlu.", errors.New("missing params"))
		return
	}

	if vault.IsNil(h.Vault) {
		writeError(w, h.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
			"Vault entegrasyonu yapılandırılmamış.", vault.ErrVaultDisabled)
		return
	}

	ctx := r.Context()
	userID := claims.Subject

	// Permission: same as issuance — read+ is sufficient.
	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, userID, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
				"Bu item'a erişim yetkisi yok.", nil)
			return
		}
	}

	// Best-effort revocation.
	if err := h.Vault.RevokeLease(ctx, leaseID); err != nil {
		h.Logger.Warn("vault: lease revocation failed (best-effort)",
			"item_id", itemID,
			"lease_id", leaseID,
			"error", err.Error(),
		)
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  userID,
		Action:       "item.dynamic_cred_revoked",
		ResourceType: audit.ResourceItem,
		ResourceID:   itemID,
		Details:      map[string]any{"lease_id": leaseID},
	})

	w.WriteHeader(http.StatusNoContent)
}
