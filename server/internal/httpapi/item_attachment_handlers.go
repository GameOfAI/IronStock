package httpapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/storage"
)

const (
	attachmentUploadExpiry   = 15 * time.Minute
	attachmentDownloadExpiry = 5 * time.Minute
	maxAttachmentSize        = 100 * 1024 * 1024 // 100 MiB
)

// AttachmentHandlers handles /api/v1/items/{id}/attachments endpoints.
type AttachmentHandlers struct {
	Service *auth.Service
	Storage storage.Backend
	Bucket  string
	Logger  *slog.Logger
}

type attachmentInitRequest struct {
	FileName    string  `json:"file_name"`
	ContentType string  `json:"content_type"`
	SizeBytes   int64   `json:"size_bytes"`
	IsEncrypted bool    `json:"is_encrypted"`
	FileNonce   *string `json:"file_nonce,omitempty"`
}

type attachmentInitResponse struct {
	AttachmentID string `json:"attachment_id"`
	UploadURL    string `json:"upload_url"`
	ExpiresAt    string `json:"expires_at"`
}

type attachmentResponse struct {
	ID              string  `json:"id"`
	ItemID          string  `json:"item_id"`
	FileName        string  `json:"file_name"`
	ContentType     string  `json:"content_type"`
	SizeBytes       int64   `json:"size_bytes"`
	IsEncrypted     bool    `json:"is_encrypted"`
	FileNonce       *string `json:"file_nonce,omitempty"`
	UploadConfirmed bool    `json:"upload_confirmed"`
	CreatedBy       string  `json:"created_by"`
	CreatedAt       string  `json:"created_at"`
}

type attachmentListResponse struct {
	Attachments []attachmentResponse `json:"attachments"`
}

type attachmentDownloadURLResponse struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

// InitUpload implements POST /api/v1/items/{id}/attachments
// Creates a DB record and returns a presigned PUT URL for direct-to-MinIO upload.
func (h *AttachmentHandlers) InitUpload(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"item id zorunlu.", errors.New("missing item id"))
		return
	}

	var req attachmentInitRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if strings.TrimSpace(req.FileName) == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"file_name zorunlu.", errors.New("empty file_name"))
		return
	}
	if req.SizeBytes < 0 || req.SizeBytes > maxAttachmentSize {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			fmt.Sprintf("size_bytes 0-%d arası olmalı.", maxAttachmentSize), errors.New("invalid size"))
		return
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item için yazma yetkiniz yok.", errors.New("item write denied"))
			return
		}
	}

	var attID string

	const insertSQL = `
		INSERT INTO item_attachments (
			item_id, file_name, content_type, size_bytes,
			storage_key, is_encrypted, file_nonce, created_by
		) VALUES (
			$1::uuid, $2, $3, $4,
			$5, $6, $7, $8::uuid
		)
		RETURNING id::text, created_at::text
	`
	var createdAt string
	err := h.Service.DB.QueryRow(ctx, insertSQL,
		itemID, req.FileName, req.ContentType, req.SizeBytes,
		"pending", req.IsEncrypted, req.FileNonce, claims.Subject,
	).Scan(&attID, &createdAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek kaydedilemedi.", err)
		return
	}

	storageKey := fmt.Sprintf("items/%s/attachments/%s", itemID, attID)

	const updateKeySQL = `UPDATE item_attachments SET storage_key = $1 WHERE id = $2::uuid`
	if _, err := h.Service.DB.Exec(ctx, updateKeySQL, storageKey, attID); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek anahtarı güncellenemedi.", err)
		return
	}

	uploadURL, err := h.Storage.PresignPutURL(ctx, h.Bucket, storageKey, attachmentUploadExpiry)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Yükleme URL'i üretilemedi.", err)
		return
	}

	expiresAt := time.Now().UTC().Add(attachmentUploadExpiry).Format(time.RFC3339)
	writeJSON(w, http.StatusCreated, attachmentInitResponse{
		AttachmentID: attID,
		UploadURL:    uploadURL,
		ExpiresAt:    expiresAt,
	})
}

// ConfirmUpload implements POST /api/v1/items/{id}/attachments/{att_id}/confirm
// Marks the attachment as upload_confirmed=true.
func (h *AttachmentHandlers) ConfirmUpload(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	attID := chi.URLParam(r, "att_id")
	if itemID == "" || attID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve att_id zorunlu.", errors.New("missing params"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item için yazma yetkiniz yok.", errors.New("item write denied"))
			return
		}
	}

	const sql = `
		UPDATE item_attachments SET upload_confirmed = true
		WHERE id = $1::uuid AND item_id = $2::uuid AND upload_confirmed = false
	`
	tag, err := h.Service.DB.Exec(ctx, sql, attID, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Onaylama başarısız.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
			"Ek bulunamadı veya zaten onaylı.", errors.New("not found or already confirmed"))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// List implements GET /api/v1/items/{id}/attachments
func (h *AttachmentHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id zorunlu.", errors.New("missing item id"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Item bulunamadı.", errors.New("item not found or no permission"))
			return
		}
	}

	const sql = `
		SELECT id::text, item_id::text, file_name, content_type, size_bytes,
		       is_encrypted, file_nonce, upload_confirmed, created_by::text, created_at::text
		FROM item_attachments
		WHERE item_id = $1::uuid AND upload_confirmed = true
		ORDER BY created_at ASC
	`
	rows, err := h.Service.DB.Query(ctx, sql, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ekler sorgulanamadı.", err)
		return
	}
	defer rows.Close()

	attachments := make([]attachmentResponse, 0)
	for rows.Next() {
		var a attachmentResponse
		if err := rows.Scan(
			&a.ID, &a.ItemID, &a.FileName, &a.ContentType, &a.SizeBytes,
			&a.IsEncrypted, &a.FileNonce, &a.UploadConfirmed, &a.CreatedBy, &a.CreatedAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Ek okunamadı.", err)
			return
		}
		attachments = append(attachments, a)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek sorgu hatası.", err)
		return
	}

	writeJSON(w, http.StatusOK, attachmentListResponse{Attachments: attachments})
}

// GetDownloadURL implements GET /api/v1/items/{id}/attachments/{att_id}/url
func (h *AttachmentHandlers) GetDownloadURL(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	attID := chi.URLParam(r, "att_id")
	if itemID == "" || attID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve att_id zorunlu.", errors.New("missing params"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsRead() {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Item bulunamadı.", errors.New("item not found or no permission"))
			return
		}
	}

	var storageKey string
	err := h.Service.DB.QueryRow(ctx, `
		SELECT storage_key FROM item_attachments
		WHERE id = $1::uuid AND item_id = $2::uuid AND upload_confirmed = true
	`, attID, itemID).Scan(&storageKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Ek bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek sorgulanamadı.", err)
		return
	}

	url, err := h.Storage.PresignGetURL(ctx, h.Bucket, storageKey, attachmentDownloadExpiry)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"İndirme URL'i üretilemedi.", err)
		return
	}

	expiresAt := time.Now().UTC().Add(attachmentDownloadExpiry).Format(time.RFC3339)
	writeJSON(w, http.StatusOK, attachmentDownloadURLResponse{
		URL:       url,
		ExpiresAt: expiresAt,
	})
}

// Delete implements DELETE /api/v1/items/{id}/attachments/{att_id}
func (h *AttachmentHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	itemID := chi.URLParam(r, "id")
	attID := chi.URLParam(r, "att_id")
	if itemID == "" || attID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"id ve att_id zorunlu.", errors.New("missing params"))
		return
	}

	ctx := r.Context()

	if !hasRole(claims, RoleAdmin) {
		perm, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Yetki sorgulanamadı.", err)
			return
		}
		if !perm.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized,
				"Bu item için yazma yetkiniz yok.", errors.New("item write denied"))
			return
		}
	}

	var storageKey string
	err := h.Service.DB.QueryRow(ctx, `
		SELECT storage_key FROM item_attachments
		WHERE id = $1::uuid AND item_id = $2::uuid
	`, attID, itemID).Scan(&storageKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound,
				"Ek bulunamadı.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek sorgulanamadı.", err)
		return
	}

	if _, err := h.Service.DB.Exec(ctx,
		`DELETE FROM item_attachments WHERE id = $1::uuid AND item_id = $2::uuid`,
		attID, itemID,
	); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Ek silinemedi.", err)
		return
	}

	// Best-effort MinIO delete — don't fail the request if object is gone.
	_ = h.Storage.Delete(ctx, h.Bucket, storageKey)

	w.WriteHeader(http.StatusNoContent)
}
