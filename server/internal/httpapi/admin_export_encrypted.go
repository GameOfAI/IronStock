package httpapi

// admin_export_encrypted.go — PR-EXPORT: Şifreli bulk export (encrypted ZIP).
//
// POST /api/v1/admin/export/encrypted
//
// Admin-only. Returns a ZIP archive containing all items' encrypted data
// (ciphertext blobs) + user keypair metadata, suitable for disaster recovery.
//
// ZIP contents:
//   manifest.json   — export metadata (version, timestamp, item/keypair counts)
//   items.json      — items with name_enc, name_nonce, server_dek_wrapped,
//                     current field values (value_enc + value_nonce per field),
//                     tags, type, folder
//   shares.json     — active item_shares (e2e_dek_wrapped + wrap_nonce per user)
//   keypairs.json   — user keypairs (public_key, private_key_enc, kek_salt, kek_params)
//
// Security notes:
//   - Exported blobs are AES-GCM ciphertexts; server cannot read plaintext values.
//   - Each recipient user can decrypt only shares wrapped with their public key.
//   - The archive itself is NOT additionally encrypted by the server — clients
//     should store it in a secure location (encrypted volume, password manager).
//   - Audit: admin.export_encrypted_started + admin.export_encrypted_completed.
//
// Scope options: "all" | "folder:{uuid}" | "user:{uuid}"
// Request body: {"scope":"all","include_attachments":false}
// (include_attachments currently returns the metadata only; blob streaming TODO)

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"time"

	"envanter.app/server/internal/audit"
)

// encryptedExportRequest is the JSON body for POST /api/v1/admin/export/encrypted.
type encryptedExportRequest struct {
	Scope              string `json:"scope"`               // "all" | "folder:{uuid}" | "user:{uuid}"
	IncludeAttachments bool   `json:"include_attachments"` // attachment metadata only for now
}

// encryptedManifest is written as manifest.json inside the ZIP.
type encryptedManifest struct {
	Version        string `json:"version"`
	ExportedAt     string `json:"exported_at"`
	Scope          string `json:"scope"`
	ItemCount      int    `json:"item_count"`
	ShareCount     int    `json:"share_count"`
	KeypairCount   int    `json:"keypair_count"`
	IronStockBuild string `json:"ironstock_build"`
}

// exportEncryptedItem is a single item entry in items.json.
// All values are base64-encoded bytes from the database (AES-GCM ciphertext).
type exportEncryptedItem struct {
	ID               string                 `json:"id"`
	ItemTypeID       int16                  `json:"item_type_id"`
	FolderID         string                 `json:"folder_id"`
	NameEnc          string                 `json:"name_enc"`           // base64
	NameNonce        string                 `json:"name_nonce"`         // base64
	ServerDEKWrapped string                 `json:"server_dek_wrapped"` // base64
	Description      *string                `json:"description,omitempty"`
	Tags             []string               `json:"tags"`
	ExpiresAt        *string                `json:"expires_at,omitempty"`
	CreatedAt        string                 `json:"created_at"`
	UpdatedAt        string                 `json:"updated_at"`
	Fields           []exportEncryptedField `json:"fields"`
}

// exportEncryptedField is one field_value entry per item.
type exportEncryptedField struct {
	FieldDefID int64  `json:"field_def_id"`
	ValueEnc   string `json:"value_enc,omitempty"`   // base64 AES-GCM ciphertext
	ValueNonce string `json:"value_nonce,omitempty"` // base64 12-byte nonce
	IsSecret   bool   `json:"is_secret"`
}

// exportEncryptedShare is one item_share entry in shares.json.
type exportEncryptedShare struct {
	ID            string `json:"id"`
	ItemID        string `json:"item_id"`
	UserID        string `json:"user_id"`
	E2EDEKWrapped string `json:"e2e_dek_wrapped"` // base64
	WrapNonce     string `json:"wrap_nonce"`      // base64
	Permission    string `json:"permission"`
	GrantedBy     string `json:"granted_by"`
	GrantedAt     string `json:"granted_at"`
}

// exportEncryptedKeypair is one user_keypairs entry in keypairs.json.
type exportEncryptedKeypair struct {
	UserID        string          `json:"user_id"`
	Version       int16           `json:"version"`
	PublicKey     string          `json:"public_key"`      // base64 32-byte X25519
	PrivateKeyEnc string          `json:"private_key_enc"` // base64 AES-GCM enc private key
	KEKSalt       string          `json:"kek_salt"`        // base64
	KEKParams     json.RawMessage `json:"kek_params"`      // Argon2id params JSON
	CreatedAt     string          `json:"created_at"`
}

// ExportEncrypted implements POST /api/v1/admin/export/encrypted.
func (h *ExportHandlers) ExportEncrypted(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil || !hasRole(claims, RoleAdmin) {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden,
			"Admin yetkisi gerekli.", errors.New("not admin"))
		return
	}

	var req encryptedExportRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.Scope == "" {
		req.Scope = "all"
	}

	// Validate scope format.
	if req.Scope != "all" {
		// Must be "folder:{uuid}" or "user:{uuid}"
		if len(req.Scope) < 8 || (req.Scope[:7] != "folder:" && req.Scope[:5] != "user:") {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"scope 'all', 'folder:{uuid}' veya 'user:{uuid}' olmalı.", nil)
			return
		}
	}

	ctx := r.Context()
	userID := claims.Subject

	// Audit: export started.
	ip, _ := netip.ParseAddr(r.Header.Get("X-Real-IP"))
	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: userID,
		Action:      "admin.export_encrypted_started",
		IPAddress:   ip,
		Details:     map[string]any{"scope": req.Scope, "include_attachments": req.IncludeAttachments},
	})

	// ─── 1. Query items ──────────────────────────────────────────────────────

	itemsQuery := `
		SELECT
		    i.id::text,
		    i.item_type_id,
		    i.folder_id::text,
		    i.name_enc,
		    i.name_nonce,
		    i.server_dek_wrapped,
		    i.description,
		    i.expires_at::text,
		    i.created_at::text,
		    i.updated_at::text,
		    COALESCE(
		        array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL),
		        '{}'::text[]
		    ) AS tags
		FROM items i
		LEFT JOIN item_tags itg ON itg.item_id = i.id
		LEFT JOIN tags t        ON t.id = itg.tag_id
		%s
		GROUP BY i.id
		ORDER BY i.created_at
	`

	var (
		whereClause string
		whereArgs   []any
	)
	switch {
	case req.Scope == "all":
		whereClause = ""
	case len(req.Scope) > 7 && req.Scope[:7] == "folder:":
		whereClause = "WHERE i.folder_id = $1::uuid"
		whereArgs = []any{req.Scope[7:]}
	case len(req.Scope) > 5 && req.Scope[:5] == "user:":
		whereClause = `
			JOIN item_shares isu ON isu.item_id = i.id AND isu.user_id = $1::uuid AND isu.revoked_at IS NULL
		`
		whereArgs = []any{req.Scope[5:]}
	}

	rows, err := h.Service.DB.Query(ctx, fmt.Sprintf(itemsQuery, whereClause), whereArgs...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item'lar yüklenemedi.", err)
		return
	}
	defer rows.Close()

	encItems := make([]exportEncryptedItem, 0, 256)
	itemIDs := make([]string, 0, 256)

	for rows.Next() {
		var (
			ei         exportEncryptedItem
			nameEnc    []byte
			nameNonce  []byte
			dekWrapped []byte
		)
		if err := rows.Scan(
			&ei.ID, &ei.ItemTypeID, &ei.FolderID,
			&nameEnc, &nameNonce, &dekWrapped,
			&ei.Description, &ei.ExpiresAt,
			&ei.CreatedAt, &ei.UpdatedAt, &ei.Tags,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Item okunamadı.", err)
			return
		}
		if ei.Tags == nil {
			ei.Tags = []string{}
		}
		ei.NameEnc = base64.StdEncoding.EncodeToString(nameEnc)
		ei.NameNonce = base64.StdEncoding.EncodeToString(nameNonce)
		ei.ServerDEKWrapped = base64.StdEncoding.EncodeToString(dekWrapped)
		encItems = append(encItems, ei)
		itemIDs = append(itemIDs, ei.ID)
	}
	if rows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item okuma hatası.", rows.Err())
		return
	}

	// ─── 2. Query field values for each item ─────────────────────────────────

	if len(itemIDs) > 0 {
		fieldRows, err := h.Service.DB.Query(ctx, `
			SELECT
			    f.item_id::text,
			    f.field_def_id,
			    f.value_enc,
			    f.value_nonce,
			    fd.is_secret
			FROM item_fields f
			JOIN field_definitions fd ON fd.id = f.field_def_id
			WHERE f.item_id::text = ANY($1)
			ORDER BY f.item_id, f.field_def_id
		`, itemIDs)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Field değerleri yüklenemedi.", err)
			return
		}
		defer fieldRows.Close()

		// Build a map: itemID → fields.
		fieldMap := make(map[string][]exportEncryptedField, len(itemIDs))
		for fieldRows.Next() {
			var (
				itemID     string
				fieldDefID int64
				valueEnc   []byte
				valueNonce []byte
				isSecret   bool
			)
			if err := fieldRows.Scan(&itemID, &fieldDefID, &valueEnc, &valueNonce, &isSecret); err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Field okunamadı.", err)
				return
			}
			ef := exportEncryptedField{
				FieldDefID: fieldDefID,
				IsSecret:   isSecret,
			}
			if valueEnc != nil {
				ef.ValueEnc = base64.StdEncoding.EncodeToString(valueEnc)
			}
			if valueNonce != nil {
				ef.ValueNonce = base64.StdEncoding.EncodeToString(valueNonce)
			}
			fieldMap[itemID] = append(fieldMap[itemID], ef)
		}
		if fieldRows.Err() != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Field okuma hatası.", fieldRows.Err())
			return
		}

		// Attach fields to items.
		for i := range encItems {
			if fields, ok := fieldMap[encItems[i].ID]; ok {
				encItems[i].Fields = fields
			} else {
				encItems[i].Fields = []exportEncryptedField{}
			}
		}
	}

	// ─── 3. Query active shares ───────────────────────────────────────────────

	sharesQuery := `
		SELECT
		    s.id::text,
		    s.item_id::text,
		    s.user_id::text,
		    s.e2e_dek_wrapped,
		    s.wrap_nonce,
		    s.permission,
		    s.granted_by::text,
		    s.granted_at::text
		FROM item_shares s
		WHERE s.revoked_at IS NULL
	`
	var sharesArgs []any
	if req.Scope != "all" && len(itemIDs) > 0 {
		sharesQuery += " AND s.item_id::text = ANY($1)"
		sharesArgs = []any{itemIDs}
	}

	shareRows, err := h.Service.DB.Query(ctx, sharesQuery, sharesArgs...)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Paylaşımlar yüklenemedi.", err)
		return
	}
	defer shareRows.Close()

	encShares := make([]exportEncryptedShare, 0, 64)
	for shareRows.Next() {
		var (
			es        exportEncryptedShare
			dekWrap   []byte
			wrapNonce []byte
		)
		if err := shareRows.Scan(
			&es.ID, &es.ItemID, &es.UserID,
			&dekWrap, &wrapNonce,
			&es.Permission, &es.GrantedBy, &es.GrantedAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Paylaşım okunamadı.", err)
			return
		}
		es.E2EDEKWrapped = base64.StdEncoding.EncodeToString(dekWrap)
		es.WrapNonce = base64.StdEncoding.EncodeToString(wrapNonce)
		encShares = append(encShares, es)
	}
	if shareRows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Paylaşım okuma hatası.", shareRows.Err())
		return
	}

	// ─── 4. Query user keypairs ───────────────────────────────────────────────

	keypairRows, err := h.Service.DB.Query(ctx, `
		SELECT
		    user_id::text,
		    version,
		    public_key,
		    private_key_enc,
		    kek_salt,
		    kek_params,
		    created_at::text
		FROM user_keypairs
		ORDER BY created_at
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Keypair'ler yüklenemedi.", err)
		return
	}
	defer keypairRows.Close()

	encKeypairs := make([]exportEncryptedKeypair, 0, 16)
	for keypairRows.Next() {
		var (
			ek          exportEncryptedKeypair
			pubKeyBytes []byte
			privKeyEnc  []byte
			kekSalt     []byte
		)
		if err := keypairRows.Scan(
			&ek.UserID, &ek.Version,
			&pubKeyBytes, &privKeyEnc, &kekSalt,
			&ek.KEKParams, &ek.CreatedAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Keypair okunamadı.", err)
			return
		}
		ek.PublicKey = base64.StdEncoding.EncodeToString(pubKeyBytes)
		ek.PrivateKeyEnc = base64.StdEncoding.EncodeToString(privKeyEnc)
		ek.KEKSalt = base64.StdEncoding.EncodeToString(kekSalt)
		encKeypairs = append(encKeypairs, ek)
	}
	if keypairRows.Err() != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Keypair okuma hatası.", keypairRows.Err())
		return
	}

	// ─── 5. Build ZIP ─────────────────────────────────────────────────────────

	exportedAt := time.Now().UTC().Format(time.RFC3339)
	manifest := encryptedManifest{
		Version:        "1.0",
		ExportedAt:     exportedAt,
		Scope:          req.Scope,
		ItemCount:      len(encItems),
		ShareCount:     len(encShares),
		KeypairCount:   len(encKeypairs),
		IronStockBuild: "pr-export",
	}

	filename := fmt.Sprintf("ironstock-encrypted-export-%s.zip",
		exportedAt[:10])
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)

	zw := zip.NewWriter(w)

	// manifest.json
	if err := writeZIPEntry(zw, "manifest.json", manifest); err != nil {
		h.Logger.Error("export: write manifest.json failed", "error", err.Error())
		return
	}
	// items.json
	if err := writeZIPEntry(zw, "items.json", encItems); err != nil {
		h.Logger.Error("export: write items.json failed", "error", err.Error())
		return
	}
	// shares.json
	if err := writeZIPEntry(zw, "shares.json", encShares); err != nil {
		h.Logger.Error("export: write shares.json failed", "error", err.Error())
		return
	}
	// keypairs.json
	if err := writeZIPEntry(zw, "keypairs.json", encKeypairs); err != nil {
		h.Logger.Error("export: write keypairs.json failed", "error", err.Error())
		return
	}

	_ = zw.Close()

	// ─── 6. Audit ────────────────────────────────────────────────────────────

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID: userID,
		Action:      "admin.export_encrypted_completed",
		IPAddress:   ip,
		Details: map[string]any{
			"scope":         req.Scope,
			"item_count":    len(encItems),
			"share_count":   len(encShares),
			"keypair_count": len(encKeypairs),
		},
	})
}

// writeZIPEntry marshals v as JSON and writes it as a file entry in the ZIP.
func writeZIPEntry(zw *zip.Writer, name string, v any) error {
	f, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("zip: create %s: %w", name, err)
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fmt.Errorf("zip: encode %s: %w", name, err)
	}
	return nil
}
