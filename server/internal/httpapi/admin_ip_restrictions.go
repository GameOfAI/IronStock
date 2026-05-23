package httpapi

// admin_ip_restrictions.go — PR-SEC5: per-user IP whitelist + GeoIP management.
//
// PATCH /api/v1/admin/users/{id}/ip-restrictions
// Body:
//   {
//     "allowed_ip_cidrs":       ["192.168.1.0/24", "10.0.0.0/8"],
//     "allowed_country_codes":  ["TR", "DE"],
//     "deny_tor_exit":          false
//   }
//
// Any null field is treated as "leave unchanged"; pass [] to clear.

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/geoip"
)

// SetIPRestrictions implements PATCH /api/v1/admin/users/{id}/ip-restrictions.
func (h *AdminHandlers) SetIPRestrictions(w http.ResponseWriter, r *http.Request) {
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
		AllowedIPCIDRs      *[]string `json:"allowed_ip_cidrs"`
		AllowedCountryCodes *[]string `json:"allowed_country_codes"`
		DenyTorExit         *bool     `json:"deny_tor_exit"`
	}
	if !decodeJSON(w, r, h.Logger, &body) {
		return
	}

	// Validate CIDRs if provided
	if body.AllowedIPCIDRs != nil {
		for _, cidr := range *body.AllowedIPCIDRs {
			if _, err := geoip.ParseCIDRList(cidr); err != nil {
				writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
					"Geçersiz CIDR: "+cidr, err)
				return
			}
		}
	}

	ctx := r.Context()

	// Build SET clause dynamically for only provided fields
	setClauses := []string{}
	args := []any{id}

	if body.AllowedIPCIDRs != nil {
		args = append(args, *body.AllowedIPCIDRs)
		setClauses = append(setClauses, "allowed_ip_cidrs = $"+itoa(len(args)))
	}
	if body.AllowedCountryCodes != nil {
		args = append(args, *body.AllowedCountryCodes)
		setClauses = append(setClauses, "allowed_country_codes = $"+itoa(len(args)))
	}
	if body.DenyTorExit != nil {
		args = append(args, *body.DenyTorExit)
		setClauses = append(setClauses, "deny_tor_exit = $"+itoa(len(args)))
	}

	if len(setClauses) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	sql := "UPDATE users SET "
	for i, c := range setClauses {
		if i > 0 {
			sql += ", "
		}
		sql += c
	}
	sql += " WHERE id = $1::uuid"

	tag, err := h.Service.DB.Exec(ctx, sql, args...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"IP kısıtlamaları güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Kullanıcı bulunamadı.", errors.New("no user"))
		return
	}

	details := map[string]any{}
	if body.AllowedIPCIDRs != nil {
		details["allowed_ip_cidrs"] = *body.AllowedIPCIDRs
	}
	if body.AllowedCountryCodes != nil {
		details["allowed_country_codes"] = *body.AllowedCountryCodes
	}
	if body.DenyTorExit != nil {
		details["deny_tor_exit"] = *body.DenyTorExit
	}
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       "admin.ip_restrictions_updated",
		ResourceType: audit.ResourceUser,
		ResourceID:   id,
		Details:      details,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// GetIPRestrictions implements GET /api/v1/admin/users/{id}/ip-restrictions.
func (h *AdminHandlers) GetIPRestrictions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()
	var cidrs []string
	var countries []string
	var denyTor bool
	err := h.Service.DB.QueryRow(ctx, `
		SELECT allowed_ip_cidrs, allowed_country_codes, deny_tor_exit
		FROM users WHERE id = $1::uuid
	`, id).Scan(&cidrs, &countries, &denyTor)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"IP kısıtlamaları alınamadı.", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"allowed_ip_cidrs":      cidrs,
		"allowed_country_codes": countries,
		"deny_tor_exit":         denyTor,
	})
}

// itoa converts int to string for SQL placeholder construction.
func itoa(n int) string {
	return strconv.Itoa(n)
}
