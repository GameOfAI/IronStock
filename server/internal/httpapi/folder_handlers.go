package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
)

// FolderHandlers groups CRUD + ACL endpoints for /api/v1/folders.
//
// All routes are bearer-protected (RequireAccessToken middleware) — claims
// are extracted from context. Each handler runs ResolveFolderPermission
// before any state change; admin role bypasses (per RBAC §1).
type FolderHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// folderRequest is the create / update body. name is plaintext; the server
// envelope-encrypts it before writing (ADR-0004 §6) and stores an HMAC
// blind-index for search.
type folderRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id,omitempty"` // nil = root folder
	Position int     `json:"position,omitempty"`
}

type folderResponse struct {
	ID        string  `json:"id"`
	ParentID  *string `json:"parent_id,omitempty"`
	Name      string  `json:"name"`
	Position  int     `json:"position"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	// Permission is the caller's effective permission on this folder
	// ("read" | "write"). Useful for UI: hide edit buttons when read-only.
	Permission auth.FolderPermission `json:"permission"`
}

type folderListResponse struct {
	Folders []folderResponse `json:"folders"`
}

// Create implements POST /api/v1/folders.
//
// Caller needs Write on the parent folder (or admin) to create a child.
// Root folders (parent_id = nil) require admin role per ADR-0006 §3 — we
// don't want anyone creating a sibling tree to bypass folder ACLs.
func (h *FolderHandlers) Create(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	var req folderRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if err := validateFolderRequest(req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	// Permission gate.
	if req.ParentID == nil {
		// Root folder — admin only.
		if !hasRole(claims, RoleAdmin) {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Kök klasör oluşturmak için admin yetkisi gerekli.",
				errors.New("non-admin root folder create"))
			return
		}
	} else {
		// Sub-folder — need Write on parent (admin already passes this check).
		if !hasRole(claims, RoleAdmin) {
			perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, *req.ParentID)
			if err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Yetki sorgulanamadı.", err)
				return
			}
			if !perm.AllowsWrite() {
				writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
					"Bu klasörde yazma yetkiniz yok.", errors.New("parent write denied"))
				return
			}
		}
	}

	// Envelope-encrypt name.
	nameEnc, nameNonce, err := encryptFolderName(h.Service, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör adı şifrelenemedi.", err)
		return
	}
	nameSearch, err := crypto.SearchHash(h.Service.SearchKey, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör adı index'i üretilemedi.", err)
		return
	}

	const insertSQL = `
		INSERT INTO folders (
		    parent_id, name_enc, name_nonce, name_search,
		    master_key_id, position, created_by
		) VALUES (
		    $1, $2, $3, $4, $5, $6, $7::uuid
		)
		RETURNING id::text, created_at::text, updated_at::text
	`
	var id, createdAt, updatedAt string
	err = h.Service.DB.QueryRow(ctx, insertSQL,
		nullableUUID(req.ParentID),
		nameEnc, nameNonce, nameSearch,
		h.Service.MasterKey.ID,
		req.Position,
		claims.Subject,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör kaydedilemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderCreated,
		ResourceType: audit.ResourceFolder,
		ResourceID:   id,
		Details:      map[string]any{"parent_id": ptrStringOrEmpty(req.ParentID)},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	writeJSON(w, http.StatusCreated, folderResponse{
		ID:         id,
		ParentID:   req.ParentID,
		Name:       req.Name,
		Position:   req.Position,
		CreatedBy:  claims.Subject,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		Permission: auth.FolderPermWrite,
	})
}

// List implements GET /api/v1/folders[?parent_id=].
//
// When parent_id is omitted: returns root folders the caller can READ.
// When set: returns immediate children of that folder, gated by Read on
// the parent. Admin sees everything regardless.
func (h *FolderHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}

	parent := r.URL.Query().Get("parent_id")
	ctx := r.Context()

	if parent != "" && !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, parent)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			// Don't leak existence — same envelope as 404.
			writeJSON(w, http.StatusOK, folderListResponse{Folders: []folderResponse{}})
			return
		}
	}

	rows, err := fetchFolderList(ctx, h.Service.DB, parent, claims, hasRole(claims, RoleAdmin))
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasörler okunamadı.", err)
		return
	}

	out := make([]folderResponse, 0, len(rows))
	for _, fr := range rows {
		name, err := decryptFolderName(h.Service, fr.NameEnc)
		if err != nil {
			h.Logger.Warn("folder name decrypt failed", slog.String("folder_id", fr.ID))
			continue
		}
		// Per-row effective permission — UI uses this to hide edit buttons.
		perm := auth.FolderPermWrite
		if !hasRole(claims, RoleAdmin) {
			p, _ := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, fr.ID)
			perm = p
			if perm == auth.FolderPermNone {
				continue // hide unreadable rows
			}
		}
		out = append(out, folderResponse{
			ID:         fr.ID,
			ParentID:   fr.ParentID,
			Name:       name,
			Position:   fr.Position,
			CreatedBy:  fr.CreatedBy,
			CreatedAt:  fr.CreatedAt,
			UpdatedAt:  fr.UpdatedAt,
			Permission: perm,
		})
	}

	writeJSON(w, http.StatusOK, folderListResponse{Folders: out})
}

// Get implements GET /api/v1/folders/{id}.
func (h *FolderHandlers) Get(w http.ResponseWriter, r *http.Request) {
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
	perm := auth.FolderPermWrite
	if !hasRole(claims, RoleAdmin) {
		p, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, id)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !p.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Klasör bulunamadı.", errors.New("denied"))
			return
		}
		perm = p
	}

	row, err := fetchFolderRow(ctx, h.Service.DB, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
				"Klasör bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör okunamadı.", err)
		return
	}

	name, err := decryptFolderName(h.Service, row.NameEnc)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör adı çözülemedi.", err)
		return
	}

	writeJSON(w, http.StatusOK, folderResponse{
		ID:         row.ID,
		ParentID:   row.ParentID,
		Name:       name,
		Position:   row.Position,
		CreatedBy:  row.CreatedBy,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
		Permission: perm,
	})
}

// Update implements PUT /api/v1/folders/{id}.
//
// Allows: rename and re-parent. Re-parenting requires Write on BOTH the
// folder being moved AND the new parent (admin bypasses).
func (h *FolderHandlers) Update(w http.ResponseWriter, r *http.Request) {
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

	var req folderRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if err := validateFolderRequest(req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		// Need Write on the folder itself.
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, id)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Yazma yetkisi yok.", errors.New("write denied"))
			return
		}
		// And Write on the destination parent if re-parenting.
		if req.ParentID != nil {
			p2, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, *req.ParentID)
			if err != nil {
				writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
					"Hedef klasör yetkisi sorgulanamadı.", err)
				return
			}
			if !p2.AllowsWrite() {
				writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
					"Hedef klasörde yazma yetkisi yok.", errors.New("parent write denied"))
				return
			}
		}
	}

	nameEnc, nameNonce, err := encryptFolderName(h.Service, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör adı şifrelenemedi.", err)
		return
	}
	nameSearch, err := crypto.SearchHash(h.Service.SearchKey, req.Name)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör adı index'i üretilemedi.", err)
		return
	}

	const updateSQL = `
		UPDATE folders
		SET parent_id = $2,
		    name_enc = $3,
		    name_nonce = $4,
		    name_search = $5,
		    master_key_id = $6,
		    position = $7
		WHERE id = $1::uuid
	`
	if _, err := h.Service.DB.Exec(ctx, updateSQL,
		id,
		nullableUUID(req.ParentID),
		nameEnc, nameNonce, nameSearch,
		h.Service.MasterKey.ID,
		req.Position,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör güncellenemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderUpdated,
		ResourceType: audit.ResourceFolder,
		ResourceID:   id,
		Details:      map[string]any{"parent_id": ptrStringOrEmpty(req.ParentID)},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// Delete implements DELETE /api/v1/folders/{id}.
//
// CASCADE in schema: all child folders + items + permissions go with it.
// Caller needs Write on the folder (admin bypasses).
func (h *FolderHandlers) Delete(w http.ResponseWriter, r *http.Request) {
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
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, id)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Yazma yetkisi yok.", errors.New("write denied"))
			return
		}
	}

	const deleteSQL = `DELETE FROM folders WHERE id = $1::uuid`
	tag, err := h.Service.DB.Exec(ctx, deleteSQL, id)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Klasör silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeBadRequest,
			"Klasör bulunamadı.", errors.New("no rows"))
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderDeleted,
		ResourceType: audit.ResourceFolder,
		ResourceID:   id,
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// validateFolderRequest checks shape only — RBAC and existence checks are
// the handler's job.
func validateFolderRequest(req folderRequest) error {
	if req.Name == "" {
		return errors.New("name zorunlu")
	}
	if len(req.Name) > 200 {
		return errors.New("name 200 karakterden uzun olamaz")
	}
	return nil
}

// folderRow is the projection returned by fetchFolderList / fetchFolderRow.
type folderRow struct {
	ID        string
	ParentID  *string
	NameEnc   []byte
	Position  int
	CreatedBy string
	CreatedAt string
	UpdatedAt string
}

func fetchFolderRow(ctx context.Context, db auth.DBExec, id string) (folderRow, error) {
	const sqlText = `
		SELECT id::text, parent_id::text, name_enc, position,
		       created_by::text, created_at::text, updated_at::text
		FROM folders
		WHERE id = $1::uuid
		LIMIT 1
	`
	var row folderRow
	err := db.QueryRow(ctx, sqlText, id).Scan(
		&row.ID, &row.ParentID, &row.NameEnc, &row.Position,
		&row.CreatedBy, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// fetchFolderList returns folders under parent (or roots when parent="").
//
// Done as a single SQL with array_agg to stay inside the auth.DBExec
// interface (no Query method).
func fetchFolderList(
	ctx context.Context, db auth.DBExec,
	parent string, _ *auth.Claims, _ bool,
) ([]folderRow, error) {
	var sqlText string
	var args []any
	if parent == "" {
		sqlText = `
			SELECT
			    COALESCE(array_agg(id::text          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(parent_id::text   ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(name_enc          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(position          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(created_by::text  ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(created_at::text  ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(updated_at::text  ORDER BY position, name_search), '{}')
			FROM folders WHERE parent_id IS NULL
		`
	} else {
		sqlText = `
			SELECT
			    COALESCE(array_agg(id::text          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(parent_id::text   ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(name_enc          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(position          ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(created_by::text  ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(created_at::text  ORDER BY position, name_search), '{}'),
			    COALESCE(array_agg(updated_at::text  ORDER BY position, name_search), '{}')
			FROM folders WHERE parent_id = $1::uuid
		`
		args = append(args, parent)
	}

	var ids, parents, createdBys, createdAts, updatedAts []string
	var nameEncs [][]byte
	var positions []int
	if err := db.QueryRow(ctx, sqlText, args...).Scan(
		&ids, &parents, &nameEncs, &positions, &createdBys, &createdAts, &updatedAts,
	); err != nil {
		return nil, err
	}

	out := make([]folderRow, 0, len(ids))
	for i := range ids {
		var p *string
		if i < len(parents) && parents[i] != "" {
			pp := parents[i]
			p = &pp
		}
		out = append(out, folderRow{
			ID:        ids[i],
			ParentID:  p,
			NameEnc:   nameEncs[i],
			Position:  positions[i],
			CreatedBy: createdBys[i],
			CreatedAt: createdAts[i],
			UpdatedAt: updatedAts[i],
		})
	}
	return out, nil
}

// encryptFolderName envelope-encrypts plaintext with the master cipher and
// extracts the nonce for separate persistence (matches the pattern used
// for totp_secrets in PR-5).
func encryptFolderName(svc *auth.Service, name string) (enc, nonce []byte, err error) {
	// AAD bound to the column so a moved blob can't impersonate another col.
	aad := crypto.MakeAAD("folders", "*", "name_enc")
	enc, err = svc.Master.Seal([]byte(name), aad)
	if err != nil {
		return nil, nil, err
	}
	nonce = extractNonce(enc)
	return enc, nonce, nil
}

// decryptFolderName is the inverse — same AAD pattern.
func decryptFolderName(svc *auth.Service, enc []byte) (string, error) {
	aad := crypto.MakeAAD("folders", "*", "name_enc")
	pt, err := svc.Master.Open(enc, aad)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// nullableUUID returns nil for empty / nil pointer, else the UUID string
// (Postgres casts at the placeholder).
func nullableUUID(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}
