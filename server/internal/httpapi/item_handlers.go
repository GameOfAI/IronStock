package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
	"envanter.app/server/internal/ws"
)

// publishEvent is a no-op when Hub is nil, otherwise fan-outs via Publish.
func (h *ItemHandlers) publishEvent(eventType, resourceID, actorUserID string) {
	if h.Hub == nil {
		return
	}
	h.Hub.Publish(ws.NewEvent(eventType, resourceID, actorUserID))
}

// ItemHandlers groups the /api/v1/items endpoints. Bearer-protected.
//
// Hub is optional — when non-nil, mutations broadcast WS events for
// connected clients to invalidate their cache.
type ItemHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
	Hub     *ws.Hub
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
	Description     *string          `json:"description,omitempty"`
	Fields          []itemFieldInput `json:"fields"`
	OwnerDEKWrapped []byte           `json:"owner_dek_wrapped"` // X25519 sealed-box
	OwnerWrapNonce  []byte           `json:"owner_wrap_nonce"`  // 12B (matches schema)
	ExternalSource  json.RawMessage  `json:"external_source,omitempty"`

	// Credential expiry / rotation (PR-N1).
	// expires_at: RFC 3339 timestamp; null removes expiry.
	// rotation_interval_days: "rotate every N days" policy; null clears it.
	ExpiresAt            *string `json:"expires_at,omitempty"`
	RotationIntervalDays *int    `json:"rotation_interval_days,omitempty"`
}

// itemResponse is the API representation. name is decrypted for the caller;
// fields are returned as-is (still client-encrypted).
// owner_dek_wrapped / owner_wrap_nonce are the caller's row from item_shares
// (populated on GET /items/:id; omitted on LIST to keep payloads lean).
type itemResponse struct {
	ID              string              `json:"id"`
	FolderID        string              `json:"folder_id"`
	ItemTypeID      int16               `json:"item_type_id"`
	Name            string              `json:"name"`
	Description     *string             `json:"description,omitempty"`
	Fields          []itemFieldOutput   `json:"fields"`
	CreatedBy       string              `json:"created_by"`
	CreatedAt       string              `json:"created_at"`
	UpdatedAt       string              `json:"updated_at"`
	Permission      auth.ItemPermission `json:"permission"`
	OwnerDEKWrapped []byte              `json:"owner_dek_wrapped,omitempty"`
	OwnerWrapNonce  []byte              `json:"owner_wrap_nonce,omitempty"`

	// Credential expiry / rotation (PR-N1).
	ExpiresAt            *string `json:"expires_at,omitempty"`
	RotationIntervalDays *int    `json:"rotation_interval_days,omitempty"`
	LastRotatedAt        *string `json:"last_rotated_at,omitempty"`
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
		    name_enc, name_nonce, name_search, name_plain,
		    server_dek_wrapped, master_key_id,
		    description,
		    external_source, created_by,
		    expires_at, rotation_interval_days
		) VALUES (
		    $1::uuid, $2::uuid, $3,
		    $4, $5, $6, $7,
		    $8, $9,
		    $10,
		    $11, $12::uuid,
		    $13, $14
		)
		RETURNING created_at::text, updated_at::text
	`
	var createdAt, updatedAt string
	err = tx.QueryRow(ctx, insertItemSQL,
		req.ID, req.FolderID, req.ItemTypeID,
		nameEnc, nameNonce, nameSearch, strings.ToLower(req.Name),
		serverDEKWrapped, h.Service.MasterKey.ID,
		req.Description,
		nullableJSON(req.ExternalSource), claims.Subject,
		req.ExpiresAt, req.RotationIntervalDays,
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
	h.publishEvent(ws.EventItemCreated, req.ID, claims.Subject)

	writeJSON(w, http.StatusCreated, itemResponse{
		ID:                   req.ID,
		FolderID:             req.FolderID,
		ItemTypeID:           req.ItemTypeID,
		Name:                 req.Name,
		Description:          req.Description,
		Fields:               fieldInputsToOutputs(req.Fields),
		CreatedBy:            claims.Subject,
		CreatedAt:            createdAt,
		UpdatedAt:            updatedAt,
		Permission:           auth.ItemPermWrite,
		OwnerDEKWrapped:      req.OwnerDEKWrapped,
		OwnerWrapNonce:       req.OwnerWrapNonce,
		ExpiresAt:            req.ExpiresAt,
		RotationIntervalDays: req.RotationIntervalDays,
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

	item, err := fetchItemFull(ctx, h.Service.DB, h.Service, id, claims.Subject)
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

	// Async audit — item.viewed tracks every full-detail read (fields included).
	// Written off the hot path to avoid adding a DB round-trip to every GET.
	h.Audit.WriteAsync(audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemViewed,
		ResourceType: audit.ResourceItem,
		ResourceID:   id,
		Details:      map[string]any{"folder_id": item.FolderID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

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

	rows, err := fetchItemList(ctx, h.Service.DB, folderID, q)
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
			ID:                   ir.ID,
			FolderID:             ir.FolderID,
			ItemTypeID:           ir.ItemTypeID,
			Name:                 name,
			CreatedBy:            ir.CreatedBy,
			CreatedAt:            ir.CreatedAt,
			UpdatedAt:            ir.UpdatedAt,
			Permission:           perm,
			ExpiresAt:            ir.ExpiresAt,
			RotationIntervalDays: ir.RotationIntervalDays,
			LastRotatedAt:        ir.LastRotatedAt,
		})
	}

	// Async audit — item.listed records folder browse events.
	h.Audit.WriteAsync(audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemListed,
		ResourceType: audit.ResourceItem,
		Details: map[string]any{
			"folder_id":    folderID,
			"result_count": len(out),
			"searched":     q != "",
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	writeJSON(w, http.StatusOK, itemListResponse{Items: out})
}

// Search implements GET /api/v1/items/search?q=term[&type_id=N][&limit=N].
//
// Cross-folder substring search across all folders the user can read.
// Results include folder_id so the client can navigate to the item.
// Max 50 results to bound query cost.
func (h *ItemHandlers) Search(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Arama terimi en az 2 karakter olmalı.", nil)
		return
	}
	limit := parseIntDefault(r.URL.Query().Get("limit"), 50, 1, 100)
	typeIDStr := r.URL.Query().Get("type_id")

	ctx := r.Context()
	term := "%" + strings.ToLower(q) + "%"

	var rows *pgx.Rows
	var err error

	// Admin can search all items; others are restricted to accessible folders.
	if hasRole(claims, RoleAdmin) {
		var qb strings.Builder
		args := []any{term, limit}
		qb.WriteString(`
			SELECT i.id::text, i.folder_id::text, i.item_type_id,
			       i.name_enc, i.server_dek_wrapped,
			       i.created_by::text, i.created_at::text, i.updated_at::text,
			       i.expires_at::text, i.rotation_interval_days, i.last_rotated_at::text
			FROM items i
			WHERE (i.name_plain LIKE $1 OR lower(coalesce(i.description,'')) LIKE $1)
		`)
		if typeIDStr != "" {
			args = append(args, typeIDStr)
			qb.WriteString(` AND i.item_type_id = $` + fmt.Sprint(len(args)))
		}
		qb.WriteString(` ORDER BY i.name_plain LIMIT $2`)
		r2, e := h.Service.DB.Query(ctx, qb.String(), args...)
		if e != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Arama hatası.", e)
			return
		}
		rows = &r2
		err = e
	} else {
		var qb strings.Builder
		args := []any{claims.Subject, term, limit}
		qb.WriteString(`
			WITH accessible AS (
			    SELECT DISTINCT folder_id FROM folder_permissions
			    WHERE user_id = $1::uuid AND permission IN ('read','write','admin')
			    UNION
			    SELECT DISTINCT fgp.folder_id FROM folder_group_permissions fgp
			    JOIN group_members gm ON gm.group_id = fgp.group_id
			    WHERE gm.user_id = $1::uuid
			)
			SELECT i.id::text, i.folder_id::text, i.item_type_id,
			       i.name_enc, i.server_dek_wrapped,
			       i.created_by::text, i.created_at::text, i.updated_at::text,
			       i.expires_at::text, i.rotation_interval_days, i.last_rotated_at::text
			FROM items i
			JOIN accessible a ON a.folder_id = i.folder_id
			WHERE (i.name_plain LIKE $2 OR lower(coalesce(i.description,'')) LIKE $2)
		`)
		if typeIDStr != "" {
			args = append(args, typeIDStr)
			qb.WriteString(` AND i.item_type_id = $` + fmt.Sprint(len(args)))
		}
		qb.WriteString(` ORDER BY i.name_plain LIMIT $3`)
		r2, e := h.Service.DB.Query(ctx, qb.String(), args...)
		rows = &r2
		err = e
	}
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Arama hatası.", err)
		return
	}
	defer (*rows).Close()

	out := make([]itemResponse, 0, limit)
	for (*rows).Next() {
		var ir itemRow
		var expiresAt, lastRotatedAt *string
		var rotInterval *int
		if err := (*rows).Scan(
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

		name, err := decryptItemName(h.Service, ir.ID, ir.ServerDEKWrapped, ir.NameEnc)
		if err != nil {
			continue
		}
		out = append(out, itemResponse{
			ID:                   ir.ID,
			FolderID:             ir.FolderID,
			ItemTypeID:           ir.ItemTypeID,
			Name:                 name,
			CreatedBy:            ir.CreatedBy,
			CreatedAt:            ir.CreatedAt,
			UpdatedAt:            ir.UpdatedAt,
			ExpiresAt:            ir.ExpiresAt,
			RotationIntervalDays: ir.RotationIntervalDays,
			LastRotatedAt:        ir.LastRotatedAt,
		})
	}

	h.Audit.WriteAsync(audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemListed,
		ResourceType: audit.ResourceItem,
		Details:      map[string]any{"q": q, "result_count": len(out), "global_search": true},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

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
		    name_search = $5,
		    name_plain = $6,
		    description = $7,
		    expires_at = $8,
		    rotation_interval_days = $9
		WHERE id = $1::uuid
	`
	if _, err := tx.Exec(ctx, updateItemSQL, id, folderArg, nameEnc, nameNonce, nameSearch, strings.ToLower(req.Name), req.Description, req.ExpiresAt, req.RotationIntervalDays); err != nil {
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
	h.publishEvent(ws.EventItemUpdated, id, claims.Subject)

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
	h.publishEvent(ws.EventItemDeleted, id, claims.Subject)

	w.WriteHeader(http.StatusNoContent)
}

// RecordRotation implements POST /api/v1/items/{id}/rotate.
//
// Sets last_rotated_at = now() on the item. No request body needed.
// Useful for "I just rotated this credential — mark it as done".
// Item Write permission required.
func (h *ItemHandlers) RecordRotation(w http.ResponseWriter, r *http.Request) {
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

	tag, err := h.Service.DB.Exec(ctx,
		`UPDATE items SET last_rotated_at = now() WHERE id = $1::uuid`,
		id,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Rotasyon kaydedilemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Item bulunamadı.", errors.New("no rows"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionItemRotationRecorded,
		ResourceType: audit.ResourceItem,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})
	h.publishEvent(ws.EventItemUpdated, id, claims.Subject)

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
	Description      *string
	CreatedBy        string
	CreatedAt        string
	UpdatedAt        string

	// Credential expiry / rotation (PR-N1).
	ExpiresAt            *string
	RotationIntervalDays *int
	LastRotatedAt        *string
}

func fetchItemForUpdate(ctx context.Context, db auth.DBExec, id string) (itemRow, error) {
	const sqlText = `
		SELECT id::text, folder_id::text, item_type_id,
		       name_enc, server_dek_wrapped,
		       description,
		       created_by::text, created_at::text, updated_at::text,
		       expires_at::text, rotation_interval_days, last_rotated_at::text
		FROM items WHERE id = $1::uuid LIMIT 1
	`
	var row itemRow
	err := db.QueryRow(ctx, sqlText, id).Scan(
		&row.ID, &row.FolderID, &row.ItemTypeID,
		&row.NameEnc, &row.ServerDEKWrapped,
		&row.Description,
		&row.CreatedBy, &row.CreatedAt, &row.UpdatedAt,
		&row.ExpiresAt, &row.RotationIntervalDays, &row.LastRotatedAt,
	)
	return row, err
}

// fetchItemFull returns the item + decrypted name + fields + caller's DEK wrap.
// userID is used to look up the caller's e2e_dek_wrapped row in item_shares.
// When the row is absent (e.g. admin with no share), DEK fields are omitted.
func fetchItemFull(ctx context.Context, db auth.DBExec, svc *auth.Service, id, userID string) (itemResponse, error) {
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
	dekWrapped, wrapNonce, err := fetchCallerDEK(ctx, db, id, userID)
	if err != nil {
		return itemResponse{}, err
	}
	return itemResponse{
		ID:                   row.ID,
		FolderID:             row.FolderID,
		ItemTypeID:           row.ItemTypeID,
		Name:                 name,
		Description:          row.Description,
		Fields:               fields,
		CreatedBy:            row.CreatedBy,
		CreatedAt:            row.CreatedAt,
		UpdatedAt:            row.UpdatedAt,
		OwnerDEKWrapped:      dekWrapped,
		OwnerWrapNonce:       wrapNonce,
		ExpiresAt:            row.ExpiresAt,
		RotationIntervalDays: row.RotationIntervalDays,
		LastRotatedAt:        row.LastRotatedAt,
	}, nil
}

// fetchCallerDEK returns the caller's e2e_dek_wrapped + wrap_nonce from
// item_shares. Returns nil slices (no error) when no share row exists for the
// caller (admin bypass path).
func fetchCallerDEK(ctx context.Context, db auth.DBExec, itemID, userID string) ([]byte, []byte, error) {
	const sqlText = `
		SELECT e2e_dek_wrapped, wrap_nonce
		FROM item_shares
		WHERE item_id = $1::uuid AND user_id = $2::uuid
		LIMIT 1
	`
	var dek, nonce []byte
	err := db.QueryRow(ctx, sqlText, itemID, userID).Scan(&dek, &nonce)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	return dek, nonce, err
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

// fetchItemList returns items in a folder, optionally filtered by a substring
// search term. When q is non-empty it matches against name_plain (ILIKE) and
// description (ILIKE), enabling proper prefix/substring search (PR-SEARCH).
// Falls back to name_search (HMAC exact) when name_plain IS NULL (legacy rows
// not yet backfilled — see backfillNamePlain in main.go).
func fetchItemList(ctx context.Context, db auth.DBExec, folderID string, q string) ([]itemRow, error) {
	var sqlText string
	var args []any

	const colList = `
		    COALESCE(array_agg(id::text               ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(folder_id::text         ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(item_type_id            ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(name_enc                ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(server_dek_wrapped      ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(created_by::text        ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(created_at::text        ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(updated_at::text        ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(expires_at::text        ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(rotation_interval_days  ORDER BY COALESCE(name_plain, '')), '{}'),
		    COALESCE(array_agg(last_rotated_at::text   ORDER BY COALESCE(name_plain, '')),'{}')
	`

	if q != "" {
		term := "%" + strings.ToLower(q) + "%"
		sqlText = `SELECT` + colList + `
			FROM items
			WHERE folder_id = $1::uuid
			  AND (
			        (name_plain IS NOT NULL AND name_plain LIKE $2)
			     OR (name_plain IS NULL     AND name_search = $3)
			     OR (description IS NOT NULL AND lower(description) LIKE $2)
			  )
		`
		// $3 = legacy HMAC fallback for un-backfilled rows (will be phased out)
		// We pass zero bytes so it never matches unless name_plain is NULL.
		args = []any{folderID, term, []byte(nil)}
	} else {
		sqlText = `SELECT` + colList + `FROM items WHERE folder_id = $1::uuid`
		args = []any{folderID}
	}

	var ids, folderIDs, createdBys, createdAts, updatedAts []string
	var expiresAts, lastRotatedAts []*string
	var typeIDs []int16
	var rotIntervals []*int
	var nameEncs, dekWraps [][]byte
	if err := db.QueryRow(ctx, sqlText, args...).Scan(
		&ids, &folderIDs, &typeIDs, &nameEncs, &dekWraps,
		&createdBys, &createdAts, &updatedAts,
		&expiresAts, &rotIntervals, &lastRotatedAts,
	); err != nil {
		return nil, err
	}
	out := make([]itemRow, 0, len(ids))
	for i := range ids {
		row := itemRow{
			ID:               ids[i],
			FolderID:         folderIDs[i],
			ItemTypeID:       typeIDs[i],
			NameEnc:          nameEncs[i],
			ServerDEKWrapped: dekWraps[i],
			CreatedBy:        createdBys[i],
			CreatedAt:        createdAts[i],
			UpdatedAt:        updatedAts[i],
		}
		if i < len(expiresAts) {
			row.ExpiresAt = expiresAts[i]
		}
		if i < len(rotIntervals) {
			row.RotationIntervalDays = rotIntervals[i]
		}
		if i < len(lastRotatedAts) {
			row.LastRotatedAt = lastRotatedAts[i]
		}
		out = append(out, row)
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

// RunItemNameBackfill fills name_plain for existing items where it is NULL.
// Should be called once at startup as a goroutine. Exits when all rows are
// backfilled or context is cancelled.
func RunItemNameBackfill(ctx context.Context, svc *auth.Service, logger *slog.Logger) {
	const batchSize = 200
	total := 0
	for {
		if ctx.Err() != nil {
			return
		}
		rows, err := svc.DB.Query(ctx, `
			SELECT id::text, server_dek_wrapped, name_enc
			FROM items
			WHERE name_plain IS NULL
			LIMIT $1
		`, batchSize)
		if err != nil {
			logger.Warn("item name backfill: query error", slog.String("error", err.Error()))
			return
		}

		type backfillRow struct {
			id         string
			dekWrapped []byte
			nameEnc    []byte
		}
		var batch []backfillRow
		for rows.Next() {
			var r backfillRow
			if err := rows.Scan(&r.id, &r.dekWrapped, &r.nameEnc); err != nil {
				logger.Warn("item name backfill: scan error", slog.String("error", err.Error()))
				rows.Close()
				return
			}
			batch = append(batch, r)
		}
		rows.Close()

		if len(batch) == 0 {
			if total > 0 {
				logger.Info("item name backfill: complete", slog.Int("total", total))
			}
			return
		}

		for _, r := range batch {
			if ctx.Err() != nil {
				return
			}
			name, err := decryptItemName(svc, r.id, r.dekWrapped, r.nameEnc)
			if err != nil {
				logger.Warn("item name backfill: decrypt error",
					slog.String("item_id", r.id),
					slog.String("error", err.Error()),
				)
				// Skip this item; it may have corrupted DEK. Continue with next.
				continue
			}
			_, err = svc.DB.Exec(ctx,
				`UPDATE items SET name_plain = $1 WHERE id = $2::uuid AND name_plain IS NULL`,
				strings.ToLower(name), r.id,
			)
			if err != nil {
				logger.Warn("item name backfill: update error",
					slog.String("item_id", r.id),
					slog.String("error", err.Error()),
				)
			} else {
				total++
			}
		}
	}
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
