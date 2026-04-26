package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// ItemHandlers groups the /api/v1/items endpoints. Bearer-protected.
type ItemHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// itemFieldInput is one row in the items.fields[] payload. value_enc and
// value_nonce are produced client-side (E2E) — server stores opaque blobs.
// nil value_enc means "external_source-backed; pull from Vault later"
// (ADR-0007).
type itemFieldInput struct {
	FieldDefinitionID int64  `json:"field_definition_id"`
	ValueEnc          []byte `json:"value_enc,omitempty"`   // client-encrypted, base64
	ValueNonce        []byte `json:"value_nonce,omitempty"` // 12B
	Position          int    `json:"position"`
}

// itemRequest is the create/update body.
//
// id: client-generated UUID v7 (ADR-0004 §5.4 — closes the AAD-pending
// problem because the AAD is bound to the row id, which the client must
// produce upfront for both encrypt-side AAD and DB INSERT).
//
// owner_dek_wrapped: client wraps a fresh per-item DEK with their own
// public key (X25519 sealed-box) — server stores the resulting blob in
// item_shares as the owner's row. Server NEVER sees the DEK plaintext.
type itemRequest struct {
	ID              string           `json:"id"`
	FolderID        string           `json:"folder_id"`
	ItemTypeID      int16            `json:"item_type_id"`
	Name            string           `json:"name"`
	Fields          []itemFieldInput `json:"fields"`
	OwnerDEKWrapped []byte           `json:"owner_dek_wrapped"` // X25519 sealed-box
	OwnerWrapNonce  []byte           `json:"owner_wrap_nonce"`  // 12B (matches schema)
	ExternalSource  json.RawMessage  `json:"external_source,omitempty"`
}

// itemResponse is the API representation. name is decrypted for the caller;
// fields are returned as-is (still client-encrypted).
type itemResponse struct {
	ID         string              `json:"id"`
	FolderID   string              `json:"folder_id"`
	ItemTypeID int16               `json:"item_type_id"`
	Name       string              `json:"name"`
	Fields     []itemFieldOutput   `json:"fields"`
	CreatedBy  string              `json:"created_by"`
	CreatedAt  string              `json:"created_at"`
	UpdatedAt  string              `json:"updated_at"`
	Permission auth.ItemPermission `json:"permission"`
}

type itemFieldOutput struct {
	FieldDefinitionID int64  `json:"field_definition_id"`
	ValueEnc          []byte `json:"value_enc,omitempty"`
	ValueNonce        []byte `json:"value_nonce,omitempty"`
	Position          int    `json:"position"`
}

type itemListResponse struct {
	Items []itemResponse `json:"items"`
}

// Create implements POST /api/v1/items.
//
// Caller needs Write on the target folder (or admin). Atomic INSERT into
// items + item_shares (owner row, write permission) + item_fields.
func (h *ItemHandlers) Create(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req itemRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if err := validateItemCreate(req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Folder Write permission (admin bypass).
	if !hasRole(claims, RoleAdmin) {
		fp, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, req.FolderID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !fp.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu klasörde yazma yetkiniz yok.", errors.New("folder write denied"))
			return
		}
	}

	// Generate a server-side DEK, wrap it with the master cipher, encrypt
	// the name with the DEK. Two-layer envelope (ADR-0004 §6).
	serverDEK, err := crypto.GenerateDEK()
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"DEK üretilemedi.", err)
		return
	}
	serverDEKWrapped, err := h.Service.Master.Seal(serverDEK,
		crypto.MakeAAD("items", req.ID, "server_dek"))
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"DEK şifrelenemedi.", err)
		return
	}
	dekCipher, err := crypto.NewCipher(serverDEK)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"DEK cipher yaratılamadı.", err)
		return
	}
	nameEnc, err := dekCipher.Seal([]byte(req.Name),
		crypto.MakeAAD("items", req.ID, "name_enc"))
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İsim şifrelenemedi.", err)
		return
	}
	nameNonce := extractNonce(nameEnc)
	nameSearch, err := crypto.SearchHash(h.Service.SearchKey, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İsim index'i üretilemedi.", err)
		return
	}

	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertItemSQL = `
		INSERT INTO items (
		    id, folder_id, item_type_id,
		    name_enc, name_nonce, name_search,
		    server_dek_wrapped, master_key_id,
		    external_source, created_by
		) VALUES (
		    $1::uuid, $2::uuid, $3,
		    $4, $5, $6,
		    $7, $8,
		    $9, $10::uuid
		)
		RETURNING created_at::text, updated_at::text
	`
	var createdAt, updatedAt string
	err = tx.QueryRow(ctx, insertItemSQL,
		req.ID, req.FolderID, req.ItemTypeID,
		nameEnc, nameNonce, nameSearch,
		serverDEKWrapped, h.Service.MasterKey.ID,
		nullableJSON(req.ExternalSource), claims.Subject,
	).Scan(&createdAt, &updatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu ID zaten kullanımda.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item kaydedilemedi.", err)
		return
	}

	// Owner row in item_shares (write permission, never revoked while owned).
	const insertOwnerShareSQL = `
		INSERT INTO item_shares (
		    item_id, user_id, e2e_dek_wrapped, wrap_nonce, permission, granted_by
		) VALUES (
		    $1::uuid, $2::uuid, $3, $4, 'write', $2::uuid
		)
	`
	if _, err := tx.Exec(ctx, insertOwnerShareSQL,
		req.ID, claims.Subject, req.OwnerDEKWrapped, req.OwnerWrapNonce,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Owner share kaydedilemedi.", err)
		return
	}

	// Insert fields (client-encrypted).
	for _, f := range req.Fields {
		if err := insertItemField(ctx, tx, req.ID, f); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Field kaydedilemedi.", err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemCreated,
		ResourceType: audit.ResourceItem,
		ResourceID:   req.ID,
		Details: map[string]any{
			"folder_id":    req.FolderID,
			"item_type_id": req.ItemTypeID,
			"field_count":  len(req.Fields),
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, itemResponse{
		ID:         req.ID,
		FolderID:   req.FolderID,
		ItemTypeID: req.ItemTypeID,
		Name:       req.Name,
		Fields:     fieldInputsToOutputs(req.Fields),
		CreatedBy:  claims.Subject,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		Permission: auth.ItemPermWrite,
	})
}

// Get implements GET /api/v1/items/{id}.
//
// Returns 404 on no-permission to avoid existence oracle.
func (h *ItemHandlers) Get(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()

	perm := auth.ItemPermWrite
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, id)
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
		perm = p
	}

	item, err := fetchItemFull(ctx, h.Service.DB, h.Service, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item okunamadı.", err)
		return
	}
	item.Permission = perm

	writeJSON(w, http.StatusOK, item)
}

// List implements GET /api/v1/items?folder_id=...&q=...
//
// folder_id zorunlu (DOS guard — kullanıcının tüm item'larını tek seferde
// dökmesin). Optional q: HMAC blind-index search.
func (h *ItemHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	folderID := r.URL.Query().Get("folder_id")
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if folderID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"folder_id zorunlu.", errors.New("missing folder_id"))
		return
	}

	ctx := r.Context()

	// Folder Read gate.
	if !hasRole(claims, RoleAdmin) {
		fp, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, folderID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !fp.AllowsRead() {
			// Hide existence — same envelope as empty result.
			writeJSON(w, http.StatusOK, itemListResponse{Items: []itemResponse{}})
			return
		}
	}

	var nameSearch []byte
	if q != "" {
		var err error
		nameSearch, err = crypto.SearchHash(h.Service.SearchKey, q)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Arama index'i üretilemedi.", err)
			return
		}
	}

	rows, err := fetchItemList(ctx, h.Service.DB, folderID, nameSearch)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item listesi okunamadı.", err)
		return
	}

	out := make([]itemResponse, 0, len(rows))
	for _, ir := range rows {
		// Per-row permission check (folder Read gate above guarantees at
		// least Read — share or owner can elevate to Write). Admin bypass
		// resolves to Write directly.
		var perm auth.ItemPermission
		if hasRole(claims, RoleAdmin) {
			perm = auth.ItemPermWrite
		} else {
			p, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, ir.ID)
			if err != nil {
				h.Logger.Warn("item permission resolve failed", slog.String("item_id", ir.ID))
				continue
			}
			if p == auth.ItemPermNone {
				continue
			}
			perm = p
		}

		name, err := decryptItemName(h.Service, ir.ID, ir.ServerDEKWrapped, ir.NameEnc)
		if err != nil {
			h.Logger.Warn("item name decrypt failed", slog.String("item_id", ir.ID))
			continue
		}
		out = append(out, itemResponse{
			ID:         ir.ID,
			FolderID:   ir.FolderID,
			ItemTypeID: ir.ItemTypeID,
			Name:       name,
			CreatedBy:  ir.CreatedBy,
			CreatedAt:  ir.CreatedAt,
			UpdatedAt:  ir.UpdatedAt,
			Permission: perm,
		})
	}

	writeJSON(w, http.StatusOK, itemListResponse{Items: out})
}

// Update implements PUT /api/v1/items/{id}.
//
// Allows: rename + folder move + field replacement (entire fields slice).
// Field replacement is "replace all" semantics for simplicity in MVP —
// granular PATCH for individual field rows is a Faz 4+ ergonomics improvement.
//
// Re-parenting requires Write on BOTH source and destination folder.
func (h *ItemHandlers) Update(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	var req itemRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"name zorunlu.", errors.New("empty name"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		// Item Write check.
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, id)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Yazma yetkisi yok.", errors.New("write denied"))
			return
		}
		// If folder change requested, also need Write on destination.
		if req.FolderID != "" {
			fp, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, req.FolderID)
			if err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Hedef klasör yetkisi sorgulanamadı.", err)
				return
			}
			if !fp.AllowsWrite() {
				writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
					"Hedef klasörde yazma yetkisi yok.", errors.New("dest folder denied"))
				return
			}
		}
	}

	// Re-derive DEK from existing wrap (same DEK; we only change name + maybe folder).
	existing, err := fetchItemForUpdate(ctx, h.Service.DB, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Item bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item okunamadı.", err)
		return
	}
	serverDEK, err := h.Service.Master.Open(existing.ServerDEKWrapped,
		crypto.MakeAAD("items", id, "server_dek"))
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"DEK çözülemedi.", err)
		return
	}
	dekCipher, err := crypto.NewCipher(serverDEK)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"DEK cipher yaratılamadı.", err)
		return
	}
	nameEnc, err := dekCipher.Seal([]byte(req.Name),
		crypto.MakeAAD("items", id, "name_enc"))
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İsim şifrelenemedi.", err)
		return
	}
	nameNonce := extractNonce(nameEnc)
	nameSearch, err := crypto.SearchHash(h.Service.SearchKey, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İsim index'i üretilemedi.", err)
		return
	}

	tx, err := h.Service.DB.Begin(ctx)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Veritabanı hatası.", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	folderArg := existing.FolderID
	if req.FolderID != "" {
		folderArg = req.FolderID
	}

	const updateItemSQL = `
		UPDATE items
		SET folder_id = $2::uuid,
		    name_enc = $3,
		    name_nonce = $4,
		    name_search = $5
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateItemSQL, id, folderArg, nameEnc, nameNonce, nameSearch); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item güncellenemedi.", err)
		return
	}

	// Replace fields if provided.
	if req.Fields != nil {
		if _, err := tx.Exec(ctx,
			`DELETE FROM item_fields WHERE item_id = $1::uuid`, id,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Eski field'lar silinemedi.", err)
			return
		}
		for _, f := range req.Fields {
			if err := insertItemField(ctx, tx, id, f); err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Field kaydedilemedi.", err)
				return
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İşlem tamamlanamadı.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemUpdated,
		ResourceType: audit.ResourceItem,
		ResourceID:   id,
		Details:      map[string]any{"folder_id": folderArg},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// Delete implements DELETE /api/v1/items/{id}.
func (h *ItemHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing id"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, id)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Yazma yetkisi yok.", errors.New("write denied"))
			return
		}
	}

	tag, err := h.Service.DB.Exec(ctx, `DELETE FROM items WHERE id = $1::uuid`, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Item silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Item bulunamadı.", errors.New("no rows"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemDeleted,
		ResourceType: audit.ResourceItem,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

// itemRow is the projection used by list / get queries.
type itemRow struct {
	ID               string
	FolderID         string
	ItemTypeID       int16
	NameEnc          []byte
	ServerDEKWrapped []byte
	CreatedBy        string
	CreatedAt        string
	UpdatedAt        string
}

func fetchItemForUpdate(ctx context.Context, db auth.DBExec, id string) (itemRow, error) {
	const sqlText = `
		SELECT id::text, folder_id::text, item_type_id,
		       name_enc, server_dek_wrapped,
		       created_by::text, created_at::text, updated_at::text
		FROM items WHERE id = $1::uuid LIMIT 1
	`
	var row itemRow
	err := db.QueryRow(ctx, sqlText, id).Scan(
		&row.ID, &row.FolderID, &row.ItemTypeID,
		&row.NameEnc, &row.ServerDEKWrapped,
		&row.CreatedBy, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// fetchItemFull returns the item + decrypted name + fields.
func fetchItemFull(ctx context.Context, db auth.DBExec, svc *auth.Service, id string) (itemResponse, error) {
	row, err := fetchItemForUpdate(ctx, db, id)
	if err != nil {
		return itemResponse{}, err
	}
	name, err := decryptItemName(svc, row.ID, row.ServerDEKWrapped, row.NameEnc)
	if err != nil {
		return itemResponse{}, err
	}
	fields, err := fetchItemFields(ctx, db, row.ID)
	if err != nil {
		return itemResponse{}, err
	}
	return itemResponse{
		ID:         row.ID,
		FolderID:   row.FolderID,
		ItemTypeID: row.ItemTypeID,
		Name:       name,
		Fields:     fields,
		CreatedBy:  row.CreatedBy,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
	}, nil
}

func fetchItemFields(ctx context.Context, db auth.DBExec, itemID string) ([]itemFieldOutput, error) {
	const sqlText = `
		SELECT
		    COALESCE(array_agg(field_definition_id ORDER BY position), '{}'),
		    COALESCE(array_agg(value_enc           ORDER BY position), '{}'),
		    COALESCE(array_agg(value_nonce         ORDER BY position), '{}'),
		    COALESCE(array_agg(position            ORDER BY position), '{}')
		FROM item_fields WHERE item_id = $1::uuid
	`
	var defIDs []int64
	var valEncs, valNonces [][]byte
	var positions []int
	if err := db.QueryRow(ctx, sqlText, itemID).Scan(&defIDs, &valEncs, &valNonces, &positions); err != nil {
		return nil, err
	}
	out := make([]itemFieldOutput, 0, len(defIDs))
	for i := range defIDs {
		out = append(out, itemFieldOutput{
			FieldDefinitionID: defIDs[i],
			ValueEnc:          valEncs[i],
			ValueNonce:        valNonces[i],
			Position:          positions[i],
		})
	}
	return out, nil
}

// fetchItemList returns items in a folder, optionally filtered by name_search.
func fetchItemList(ctx context.Context, db auth.DBExec, folderID string, nameSearch []byte) ([]itemRow, error) {
	var sqlText string
	var args []any
	if len(nameSearch) > 0 {
		sqlText = `
			SELECT
			    COALESCE(array_agg(id::text                 ORDER BY name_search), '{}'),
			    COALESCE(array_agg(folder_id::text          ORDER BY name_search), '{}'),
			    COALESCE(array_agg(item_type_id             ORDER BY name_search), '{}'),
			    COALESCE(array_agg(name_enc                 ORDER BY name_search), '{}'),
			    COALESCE(array_agg(server_dek_wrapped       ORDER BY name_search), '{}'),
			    COALESCE(array_agg(created_by::text         ORDER BY name_search), '{}'),
			    COALESCE(array_agg(created_at::text         ORDER BY name_search), '{}'),
			    COALESCE(array_agg(updated_at::text         ORDER BY name_search), '{}')
			FROM items WHERE folder_id = $1::uuid AND name_search = $2
		`
		args = []any{folderID, nameSearch}
	} else {
		sqlText = `
			SELECT
			    COALESCE(array_agg(id::text                 ORDER BY name_search), '{}'),
			    COALESCE(array_agg(folder_id::text          ORDER BY name_search), '{}'),
			    COALESCE(array_agg(item_type_id             ORDER BY name_search), '{}'),
			    COALESCE(array_agg(name_enc                 ORDER BY name_search), '{}'),
			    COALESCE(array_agg(server_dek_wrapped       ORDER BY name_search), '{}'),
			    COALESCE(array_agg(created_by::text         ORDER BY name_search), '{}'),
			    COALESCE(array_agg(created_at::text         ORDER BY name_search), '{}'),
			    COALESCE(array_agg(updated_at::text         ORDER BY name_search), '{}')
			FROM items WHERE folder_id = $1::uuid
		`
		args = []any{folderID}
	}

	var ids, folderIDs, createdBys, createdAts, updatedAts []string
	var typeIDs []int16
	var nameEncs, dekWraps [][]byte
	if err := db.QueryRow(ctx, sqlText, args...).Scan(
		&ids, &folderIDs, &typeIDs, &nameEncs, &dekWraps,
		&createdBys, &createdAts, &updatedAts,
	); err != nil {
		return nil, err
	}
	out := make([]itemRow, 0, len(ids))
	for i := range ids {
		out = append(out, itemRow{
			ID:               ids[i],
			FolderID:         folderIDs[i],
			ItemTypeID:       typeIDs[i],
			NameEnc:          nameEncs[i],
			ServerDEKWrapped: dekWraps[i],
			CreatedBy:        createdBys[i],
			CreatedAt:        createdAts[i],
			UpdatedAt:        updatedAts[i],
		})
	}
	return out, nil
}

// decryptItemName unwraps the server DEK with the master cipher, then
// decrypts name_enc with that DEK. AAD bound to the row id at both layers
// (substitution attack defense).
func decryptItemName(svc *auth.Service, itemID string, dekWrapped, nameEnc []byte) (string, error) {
	dek, err := svc.Master.Open(dekWrapped, crypto.MakeAAD("items", itemID, "server_dek"))
	if err != nil {
		return "", err
	}
	dekCipher, err := crypto.NewCipher(dek)
	if err != nil {
		return "", err
	}
	pt, err := dekCipher.Open(nameEnc, crypto.MakeAAD("items", itemID, "name_enc"))
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// insertItemField writes one field row. value_enc/value_nonce can both be
// empty for external_source-backed fields (the schema CHECK enforces all
// or nothing).
func insertItemField(ctx context.Context, tx pgx.Tx, itemID string, f itemFieldInput) error {
	if f.FieldDefinitionID <= 0 {
		return errors.New("field_definition_id zorunlu")
	}
	// Both empty is OK (external). One empty + one set is not — schema CHECK.
	if (len(f.ValueEnc) == 0) != (len(f.ValueNonce) == 0) {
		return errors.New("value_enc ve value_nonce birlikte boş veya birlikte dolu olmalı")
	}
	if len(f.ValueNonce) > 0 && len(f.ValueNonce) != crypto.AESGCMNonceLen {
		return errors.New("value_nonce 12 byte olmalı")
	}
	const sqlText = `
		INSERT INTO item_fields (
		    item_id, field_definition_id, value_enc, value_nonce, position
		) VALUES (
		    $1::uuid, $2, $3, $4, $5
		)
		ON CONFLICT (item_id, field_definition_id) DO UPDATE SET
		    value_enc = EXCLUDED.value_enc,
		    value_nonce = EXCLUDED.value_nonce,
		    position = EXCLUDED.position
	`
	_, err := tx.Exec(ctx, sqlText, itemID, f.FieldDefinitionID,
		nilIfEmpty(f.ValueEnc), nilIfEmpty(f.ValueNonce), f.Position)
	return err
}

func validateItemCreate(req itemRequest) error {
	if !looksLikeUUID(req.ID) {
		return errors.New("id geçerli UUID olmalı (client-generated v7)")
	}
	if !looksLikeUUID(req.FolderID) {
		return errors.New("folder_id geçerli UUID olmalı")
	}
	if req.ItemTypeID <= 0 {
		return errors.New("item_type_id zorunlu")
	}
	if req.Name == "" {
		return errors.New("name zorunlu")
	}
	if len(req.OwnerDEKWrapped) == 0 {
		return errors.New("owner_dek_wrapped zorunlu (client X25519 wrap)")
	}
	if len(req.OwnerWrapNonce) != crypto.AESGCMNonceLen {
		return errors.New("owner_wrap_nonce 12 byte olmalı")
	}
	return nil
}

// looksLikeUUID is a cheap shape check; the SQL `::uuid` cast does the real
// validation at INSERT.
func looksLikeUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
}

func fieldInputsToOutputs(in []itemFieldInput) []itemFieldOutput {
	out := make([]itemFieldOutput, 0, len(in))
	for _, f := range in {
		out = append(out, itemFieldOutput(f))
	}
	return out
}

func nilIfEmpty(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

func nullableJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return []byte(raw)
}
