package httpapi

// PR-IMPORT: Bulk import handlers.
//
// CSV flow:  POST /api/v1/import/csv/preview  → parsed rows (no DB write)
//            POST /api/v1/import/batch        → bulk insert pre-encrypted items
//
// KeePass (.kdbx) flow: parsed entirely in the browser (kdbxweb library).
// The client decrypts the .kdbx with the master password, encrypts E2E fields
// with the user's DEK, then sends a batch of ItemCreateRequest objects to
// POST /api/v1/import/batch. Server never sees the plaintext.
//
// Security: CSV preview is read-only (no writes). Batch uses the same
// create path as the normal item creation endpoint, so folder permission
// checks apply per-item.

import (
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// csvPreviewRow is one parsed CSV row returned to the client for review.
type csvPreviewRow struct {
	Index   int               `json:"index"`    // 0-based row number (after header)
	RawData map[string]string `json:"raw_data"` // header → value
}

type csvPreviewResponse struct {
	Headers []string        `json:"headers"`
	Rows    []csvPreviewRow `json:"rows"`
	Total   int             `json:"total"`
}

// CSVPreview implements POST /api/v1/import/csv/preview.
//
// Accepts multipart/form-data with a "file" field (CSV).
// Returns up to 500 rows for the client to review and map.
// No authentication required beyond being logged in.
func (h *ItemHandlers) CSVPreview(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB max
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Multipart parse hatası (max 10MB).", err)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"'file' alanı bulunamadı.", err)
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	// Read header row.
	headers, err := reader.Read()
	if err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"CSV header okunamadı.", err)
		return
	}
	// Trim BOM and whitespace from headers.
	for i, h := range headers {
		headers[i] = strings.TrimSpace(strings.TrimPrefix(h, "\xef\xbb\xbf"))
	}

	const maxPreviewRows = 500
	rows := make([]csvPreviewRow, 0, maxPreviewRows)
	idx := 0
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			// Skip malformed rows silently, keep going.
			idx++
			continue
		}
		rowMap := make(map[string]string, len(headers))
		for j, h := range headers {
			if j < len(record) {
				rowMap[h] = record[j]
			} else {
				rowMap[h] = ""
			}
		}
		rows = append(rows, csvPreviewRow{Index: idx, RawData: rowMap})
		idx++
		if len(rows) >= maxPreviewRows {
			break
		}
	}

	writeJSON(w, http.StatusOK, csvPreviewResponse{
		Headers: headers,
		Rows:    rows,
		Total:   idx,
	})
}

// batchImportItem is one item in a batch import request.
// Fields slice matches itemFieldInput from item_handlers.go.
type batchImportItem struct {
	ID                   string           `json:"id"`
	FolderID             string           `json:"folder_id"`
	ItemTypeID           int              `json:"item_type_id"`
	Name                 string           `json:"name"`
	Description          string           `json:"description"`
	Fields               []itemFieldInput `json:"fields"`
	OwnerDEKWrapped      []byte           `json:"owner_dek_wrapped"`
	OwnerWrapNonce       []byte           `json:"owner_wrap_nonce"`
	ExpiresAt            *time.Time       `json:"expires_at"`
	RotationIntervalDays *int             `json:"rotation_interval_days"`
}

type batchImportRequest struct {
	Items []batchImportItem `json:"items"`
}

type batchImportResponse struct {
	Created int      `json:"created"`
	Errors  []string `json:"errors"`
}

// BatchImport implements POST /api/v1/import/batch.
//
// Accepts up to 1000 pre-encrypted items. Each item must already have:
//   - E2E secret fields encrypted with its DEK
//   - DEK sealed with the caller's X25519 public key (owner_dek_wrapped)
//
// The server validates folder permission for each item (write or folder owner).
// Items are inserted individually in a best-effort loop; partial success is
// returned in the response with per-item error messages.
func (h *ItemHandlers) BatchImport(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req batchImportRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if len(req.Items) == 0 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"items boş.", errors.New("empty items"))
		return
	}
	if len(req.Items) > 1000 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Tek seferde en fazla 1000 item import edilebilir.", errors.New("too many items"))
		return
	}

	ctx := r.Context()
	created := 0
	errs := make([]string, 0)

	for _, it := range req.Items {
		if it.ID == "" || it.FolderID == "" || it.Name == "" {
			errs = append(errs, "id/folder_id/name zorunlu")
			continue
		}
		if len(it.OwnerDEKWrapped) == 0 || len(it.OwnerWrapNonce) == 0 {
			errs = append(errs, it.Name+": dek wrap eksik")
			continue
		}

		// Folder permission check (unless admin).
		if !hasRole(claims, RoleAdmin) {
			fp, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, it.FolderID)
			if err != nil || !fp.AllowsWrite() {
				errs = append(errs, it.Name+": klasör yazma yetkisi yok")
				continue
			}
		}

		// Server-side envelope: generate DEK, encrypt name (ADR-0004 §6).
		serverDEK, err := crypto.GenerateDEK()
		if err != nil {
			errs = append(errs, it.Name+": DEK üretilemedi — "+err.Error())
			continue
		}
		serverDEKWrapped, err := h.Service.Master.Seal(serverDEK,
			crypto.MakeAAD("items", it.ID, "server_dek"))
		if err != nil {
			errs = append(errs, it.Name+": DEK seal hatası — "+err.Error())
			continue
		}
		dekCipher, err := crypto.NewCipher(serverDEK)
		if err != nil {
			errs = append(errs, it.Name+": cipher hatası — "+err.Error())
			continue
		}
		nameEnc, err := dekCipher.Seal([]byte(it.Name),
			crypto.MakeAAD("items", it.ID, "name_enc"))
		if err != nil {
			errs = append(errs, it.Name+": name encrypt hatası — "+err.Error())
			continue
		}
		nameNonce := extractNonce(nameEnc)
		nameSearch, err := crypto.SearchHash(h.Service.SearchKey, it.Name)
		if err != nil {
			errs = append(errs, it.Name+": search hash hatası — "+err.Error())
			continue
		}

		const insertSQL = `
			INSERT INTO items (
				id, folder_id, item_type_id,
				name_enc, name_nonce, name_search, name_plain,
				server_dek_wrapped, master_key_id,
				description, created_by,
				expires_at, rotation_interval_days
			) VALUES (
				$1::uuid, $2::uuid, $3,
				$4, $5, $6, $7,
				$8, $9,
				$10, $11::uuid,
				$12, $13
			) ON CONFLICT (id) DO NOTHING
		`
		_, err = h.Service.DB.Exec(ctx, insertSQL,
			it.ID, it.FolderID, it.ItemTypeID,
			nameEnc, nameNonce, nameSearch, strings.ToLower(it.Name),
			serverDEKWrapped, h.Service.MasterKey.ID,
			it.Description, claims.Subject,
			it.ExpiresAt, it.RotationIntervalDays,
		)
		if err != nil {
			errs = append(errs, it.Name+": insert hatası — "+err.Error())
			continue
		}

		// Insert owner share row.
		const shareSQL = `
			INSERT INTO item_shares (item_id, user_id, e2e_dek_wrapped, wrap_nonce,
				permission, granted_by)
			VALUES ($1::uuid, $2::uuid, $3, $4, 'write', $2::uuid)
			ON CONFLICT (item_id, user_id) DO NOTHING
		`
		if _, err := h.Service.DB.Exec(ctx, shareSQL,
			it.ID, claims.Subject, it.OwnerDEKWrapped, it.OwnerWrapNonce,
		); err != nil {
			errs = append(errs, it.Name+": owner share hatası — "+err.Error())
			continue
		}

		// Insert fields.
		for _, f := range it.Fields {
			const fieldSQL = `
				INSERT INTO item_fields (item_id, field_definition_id, value_enc, value_nonce)
				VALUES ($1::uuid, $2, $3, $4)
			`
			if _, err := h.Service.DB.Exec(ctx, fieldSQL,
				it.ID, f.FieldDefinitionID, f.ValueEnc, f.ValueNonce,
			); err != nil {
				// Non-fatal: item was created, field might be optional.
				h.Logger.Warn("import: field insert failed",
					"item", it.Name, "field_definition_id", f.FieldDefinitionID, "err", err)
			}
		}

		_ = h.Audit.Write(ctx, audit.Entry{
			ActorUserID:  claims.Subject,
			Action:       "item.imported",
			ResourceType: audit.ResourceItem,
			ResourceID:   it.ID,
			Details: map[string]any{
				"name":        it.Name,
				"folder_id":   it.FolderID,
				"item_type":   it.ItemTypeID,
				"field_count": len(it.Fields),
			},
			IPAddress: parseIP(r.RemoteAddr),
			UserAgent: r.UserAgent(),
		})

		created++
	}

	writeJSON(w, http.StatusOK, batchImportResponse{
		Created: created,
		Errors:  errs,
	})
}
