package httpapi

// Notification endpoints (PR-N8).
//
// GET  /api/v1/notifications          — unread + recent (max 50)
// POST /api/v1/notifications/{id}/read — mark single notification as read
// POST /api/v1/notifications/read-all  — mark all unread as read

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/auth"
)

// NotificationHandlers groups notification endpoints.
type NotificationHandlers struct {
	Service *auth.Service
	Logger  *slog.Logger
}

type notificationResponse struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	Title        string  `json:"title"`
	Body         *string `json:"body,omitempty"`
	ResourceType *string `json:"resource_type,omitempty"`
	ResourceID   *string `json:"resource_id,omitempty"`
	ReadAt       *string `json:"read_at,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

type notificationsListResponse struct {
	Notifications []notificationResponse `json:"notifications"`
	UnreadCount   int                    `json:"unread_count"`
}

// List implements GET /api/v1/notifications.
// Returns the 50 most recent notifications for the caller,
// plus the total unread count.
func (h *NotificationHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()

	const sqlText = `
		SELECT id::text, type, title, body, resource_type, resource_id::text,
		       read_at::text, created_at::text
		FROM notifications
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC
		LIMIT 50
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bildirimler okunamadı.", err)
		return
	}
	defer rows.Close()

	notifs := make([]notificationResponse, 0, 50)
	unread := 0
	for rows.Next() {
		var n notificationResponse
		if err := rows.Scan(
			&n.ID, &n.Type, &n.Title, &n.Body, &n.ResourceType, &n.ResourceID,
			&n.ReadAt, &n.CreatedAt,
		); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Bildirim satırı okunamadı.", err)
			return
		}
		if n.ReadAt == nil {
			unread++
		}
		notifs = append(notifs, n)
	}
	if err := rows.Err(); err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bildirim sorgusu başarısız.", err)
		return
	}

	writeJSON(w, http.StatusOK, notificationsListResponse{
		Notifications: notifs,
		UnreadCount:   unread,
	})
}

// MarkRead implements POST /api/v1/notifications/{id}/read.
func (h *NotificationHandlers) MarkRead(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	notifID := chi.URLParam(r, "id")
	ctx := r.Context()

	tag, err := h.Service.DB.Exec(ctx,
		`UPDATE notifications SET read_at = now()
		 WHERE id = $1::uuid AND user_id = $2::uuid AND read_at IS NULL`,
		notifID, claims.Subject,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bildirim güncellenemedi.", err)
		return
	}
	_ = tag // idempotent — already-read is OK
	w.WriteHeader(http.StatusNoContent)
}

// MarkAllRead implements POST /api/v1/notifications/read-all.
func (h *NotificationHandlers) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()

	_, err := h.Service.DB.Exec(ctx,
		`UPDATE notifications SET read_at = now()
		 WHERE user_id = $1::uuid AND read_at IS NULL`,
		claims.Subject,
	)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Bildirimler güncellenemedi.", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UnreadCount implements GET /api/v1/notifications/unread-count.
// Lightweight endpoint for the bell badge — returns just the count.
func (h *NotificationHandlers) UnreadCount(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
			"Token gerekli.", errors.New("no claims"))
		return
	}
	ctx := r.Context()

	var count int
	err := h.Service.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL`,
		claims.Subject,
	).Scan(&count)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Sayım alınamadı.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"unread_count": count})
}

