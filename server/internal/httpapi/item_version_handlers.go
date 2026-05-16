package httpapi

// Item field version endpoints (PR-N2).
//
// GET /api/v1/items/{id}/fields/{field_def_id}/versions
//   → up to 10 previous snapshots of the field's encrypted value.
//   Caller must have at least Read on the item. Values are still
//   client-encrypted (server stores opaque blobs) — the client decrypts
//   using the same DEK as the current field.
//
// POST /api/v1/items/{id}/fields/{field_def_id}/restore/{version}
//   → client supplies re-encrypted value; handler writes it back via
//   the normal insertItemField path and the trigger snapshots the old one.
//   Requires Write permission.

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/auth"
)

// fieldVersionOutput is one row in the versions list.
type fieldVersionOutput struct {
	VersionNumber int    `json:"version_number"`
	ValueEnc      []byte `json:"value_enc,omitempty"`
	ValueNonce    []byte `json:"value_nonce,omitempty"`
	ChangedAt     string `json:"changed_at"`
}

type fieldVersionsResponse struct {
	Versions []fieldVersionOutput `json:"versions"`
}

// ListFieldVersions implements GET /api/v1/items/{id}/fields/{field_def_id}/versions.
func (h *ItemHandlers) ListFieldVersions(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	fieldDefIDStr := chi.URLParam(r, "field_def_id")
	if itemID == "" || fieldDefIDStr == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve field_def_id zorunlu.", errors.New("missing params"))
		return
	}
	fieldDefID, err := strconv.ParseInt(fieldDefIDStr, 10, 64)
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"field_def_id geçerli tamsayı olmalı.", err)
		return
	}

	ctx := r.Context()

	// Permission: Read on the item.
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", errors.New("denied"))
			return
		}
	}

	const sqlText = `
		SELECT ifv.version_number, ifv.value_enc, ifv.value_nonce, ifv.changed_at::text
		FROM item_field_versions ifv
		JOIN item_fields iff ON iff.id = ifv.item_field_id
		WHERE iff.item_id = $1::uuid
		  AND iff.field_definition_id = $2
		ORDER BY ifv.version_number DESC
		LIMIT 10
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, itemID, fieldDefID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Versiyon listesi okunamadı.", err)
		return
	}
	defer rows.Close()

	versions := make([]fieldVersionOutput, 0, 10)
	for rows.Next() {
		var v fieldVersionOutput
		if err := rows.Scan(&v.VersionNumber, &v.ValueEnc, &v.ValueNonce, &v.ChangedAt); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Versiyon satırı okunamadı.", err)
			return
		}
		versions = append(versions, v)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Versiyon sorgusu başarısız.", err)
		return
	}

	writeJSON(w, http.StatusOK, fieldVersionsResponse{Versions: versions})
}
