package httpapi

// item_duplicates.go — PR-DUP: Duplicate detection endpoint.
//
// GET /api/v1/items/duplicates?name={plaintext}[&exclude_id={uuid}][&limit=N]
//
// Finds items whose name matches the provided plaintext by comparing the
// HMAC blind-index (name_search). The server recomputes the HMAC from the
// query parameter and returns matching items — no plaintext is stored or logged.
//
// Use case: item create/edit form calls this onBlur on the name field to
// show a "Bu ada sahip N item zaten var" warning before the user saves.
//
// Security:
//   - Caller must have a valid access token.
//   - Non-admins only see duplicates within folders they can read.
//   - Admin sees all duplicates vault-wide.
//   - The HMAC query reveals nothing about existing values to observers (name
//     is sent as plaintext by the caller who already knows it).

import (
	"errors"
	"net/http"
	"strings"

	"envanter.app/server/internal/crypto"
)

// DuplicateCheckResponse is returned by GET /api/v1/items/duplicates.
type DuplicateCheckResponse struct {
	Count int            `json:"count"`
	Items []itemResponse `json:"items"`
}

// CheckDuplicates implements GET /api/v1/items/duplicates.
func (h *ItemHandlers) CheckDuplicates(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if len(name) < 1 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name parametresi zorunlu.", nil)
		return
	}

	excludeID := strings.TrimSpace(r.URL.Query().Get("exclude_id"))
	limit := parseIntDefault(r.URL.Query().Get("limit"), 10, 1, 50)

	// Compute HMAC blind index server-side using the same search key as item creation.
	nameSearch, err := crypto.SearchHash(h.Service.SearchKey, name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Arama hash hesaplanamadı.", err)
		return
	}

	ctx := r.Context()
	isAdmin := hasRole(claims, RoleAdmin)

	// Build query — admin sees all, others restricted to accessible folders.
	var (
		q    string
		args []any
	)

	const selectCols = `
		SELECT i.id::text, i.folder_id::text, i.item_type_id,
		       i.name_enc, i.server_dek_wrapped,
		       i.created_by::text, i.created_at::text, i.updated_at::text,
		       i.expires_at::text, i.rotation_interval_days, i.last_rotated_at::text
		FROM items i
	`

	if isAdmin {
		args = []any{nameSearch, limit}
		q = selectCols + `WHERE i.name_search = $1`
		if excludeID != "" {
			args = append(args, excludeID)
			q += ` AND i.id::text != $` + FormatArgN(len(args))
		}
		q += ` ORDER BY i.name_plain LIMIT $2`
	} else {
		args = []any{claims.Subject, nameSearch, limit}
		q = `
			WITH accessible AS (
			    SELECT DISTINCT folder_id FROM folder_permissions
			    WHERE user_id = $1::uuid AND permission IN ('read','write','admin')
			      AND revoked_at IS NULL
			      AND (valid_from IS NULL OR valid_from <= NOW())
			      AND (valid_until IS NULL OR valid_until > NOW())
			    UNION
			    SELECT DISTINCT fgp.folder_id FROM folder_group_permissions fgp
			    JOIN group_members gm ON gm.group_id = fgp.group_id
			    WHERE gm.user_id = $1::uuid
			      AND fgp.revoked_at IS NULL
			      AND (fgp.valid_from IS NULL OR fgp.valid_from <= NOW())
			      AND (fgp.valid_until IS NULL OR fgp.valid_until > NOW())
			)
		` + selectCols + `
			JOIN accessible a ON a.folder_id = i.folder_id
			WHERE i.name_search = $2
		`
		if excludeID != "" {
			args = append(args, excludeID)
			q += ` AND i.id::text != $` + FormatArgN(len(args))
		}
		q += ` ORDER BY i.name_plain LIMIT $3`
	}

	rows, err := h.Service.DB.Query(ctx, q, args...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Duplicate sorgusu başarısız.", err)
		return
	}
	defer rows.Close()

	out := make([]itemResponse, 0, limit)
	for rows.Next() {
		var ir itemRow
		var expiresAt, lastRotatedAt *string
		var rotInterval *int
		if err := rows.Scan(
			&ir.ID, &ir.FolderID, &ir.ItemTypeID,
			&ir.NameEnc, &ir.ServerDEKWrapped,
			&ir.CreatedBy, &ir.CreatedAt, &ir.UpdatedAt,
			&expiresAt, &rotInterval, &lastRotatedAt,
		); err != nil {
			continue
		}
		ir.ExpiresAt = expiresAt
		ir.RotationIntervalDays = rotInterval
		ir.LastRotatedAt = lastRotatedAt

		decryptedName, err := decryptItemName(h.Service, ir.ID, ir.ServerDEKWrapped, ir.NameEnc)
		if err != nil {
			continue
		}
		out = append(out, itemResponse{
			ID:                   ir.ID,
			FolderID:             ir.FolderID,
			ItemTypeID:           ir.ItemTypeID,
			Name:                 decryptedName,
			CreatedBy:            ir.CreatedBy,
			CreatedAt:            ir.CreatedAt,
			UpdatedAt:            ir.UpdatedAt,
			ExpiresAt:            ir.ExpiresAt,
			RotationIntervalDays: ir.RotationIntervalDays,
			LastRotatedAt:        ir.LastRotatedAt,
		})
	}

	writeJSON(w, http.StatusOK, DuplicateCheckResponse{
		Count: len(out),
		Items: out,
	})
}

// FormatArgN returns a PostgreSQL positional parameter string ($N).
// Exported for testing. Works for n 1-9, which is sufficient for this handler.
func FormatArgN(n int) string {
	return "$" + string(rune('0'+n))
}
