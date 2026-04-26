package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
)

type grantPermissionRequest struct {
	UserID            string `json:"user_id"`
	Permission        string `json:"permission"` // 'read' | 'write'
	InheritToChildren bool   `json:"inherit_to_children"`
}

// GrantPermission implements POST /api/v1/folders/{id}/permissions.
//
// Caller needs Write on the folder (or admin) to manage its ACL. We do NOT
// allow self-grant (a user can't escalate themselves) — this is a UX guard,
// not a security one (admin can grant anyone).
//
// Idempotent: same (folder_id, user_id) re-grant updates the row in place.
func (h *FolderHandlers) GrantPermission(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	folderID := chi.URLParam(r, "id")
	if folderID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"folder id zorunlu.", errors.New("missing id"))
		return
	}

	var req grantPermissionRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"user_id zorunlu.", errors.New("missing user_id"))
		return
	}
	if req.Permission != string(auth.FolderPermRead) && req.Permission != string(auth.FolderPermWrite) {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"permission 'read' veya 'write' olmalı.", errors.New("bad permission"))
		return
	}
	if req.UserID == claims.Subject {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"Kendinize yetki veremezsiniz.", errors.New("self-grant"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, folderID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu klasörde yetki vermek için yazma yetkisi gerekli.",
				errors.New("write denied"))
			return
		}
	}

	// UPSERT: re-granting the same user updates fields (incl. revoked_at=NULL
	// to undo a prior revoke).
	const upsertSQL = `
		INSERT INTO folder_permissions
		    (folder_id, user_id, permission, inherit_to_children, granted_by, revoked_at)
		VALUES
		    ($1::uuid, $2::uuid, $3, $4, $5::uuid, NULL)
		ON CONFLICT (folder_id, user_id) DO UPDATE SET
		    permission          = EXCLUDED.permission,
		    inherit_to_children = EXCLUDED.inherit_to_children,
		    granted_by          = EXCLUDED.granted_by,
		    granted_at          = now(),
		    revoked_at          = NULL
	`
	if _, err := h.Service.DB.Exec(ctx, upsertSQL,
		folderID, req.UserID, req.Permission, req.InheritToChildren, claims.Subject,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Yetki kaydedilemedi.", err)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderPermissionGrant,
		ResourceType: audit.ResourceFolder,
		ResourceID:   folderID,
		Details: map[string]any{
			"target_user_id":      req.UserID,
			"permission":          req.Permission,
			"inherit_to_children": req.InheritToChildren,
		},
		IPAddress: parseIP(r.RemoteAddr),
		UserAgent: r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// RevokePermission implements DELETE /api/v1/folders/{id}/permissions/{user_id}.
//
// Soft-revocation (sets revoked_at) — the row stays for audit history.
// Caller needs Write on the folder (or admin).
func (h *FolderHandlers) RevokePermission(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	folderID := chi.URLParam(r, "id")
	targetUserID := chi.URLParam(r, "user_id")
	if folderID == "" || targetUserID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve user_id zorunlu.", errors.New("missing path params"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveFolderPermission(ctx, h.Service.DB, claims.Subject, folderID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu klasörde yetki kaldırmak için yazma yetkisi gerekli.",
				errors.New("write denied"))
			return
		}
	}

	const revokeSQL = `
		UPDATE folder_permissions
		SET revoked_at = now()
		WHERE folder_id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL
	`
	tag, err := h.Service.DB.Exec(ctx, revokeSQL, folderID, targetUserID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Yetki kaldırılamadı.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Either no such grant, or already revoked. Idempotent: 204 either way.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_ = h.Audit.Write(ctx, audit.Entry{
		ActorUserID:  claims.Subject,
		Action:       audit.ActionFolderPermissionRevoke,
		ResourceType: audit.ResourceFolder,
		ResourceID:   folderID,
		Details:      map[string]any{"target_user_id": targetUserID},
		IPAddress:    parseIP(r.RemoteAddr),
		UserAgent:    r.UserAgent(),
	})

	w.WriteHeader(http.StatusNoContent)
}
