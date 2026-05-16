// Package notify provides a server-side notification writer (PR-N8).
//
// Notifications are persisted to the notifications table and optionally
// fanned out over the WS hub so connected clients see the bell badge
// update immediately (resource_id = notification UUID).
package notify

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"envanter.app/server/internal/ws"
)

// Writer creates notifications and optionally pushes WS events.
type Writer struct {
	DB     *pgxpool.Pool
	Hub    *ws.Hub // optional — nil disables WS push
	Logger *slog.Logger
}

// New returns a Writer.
func New(db *pgxpool.Pool, hub *ws.Hub, logger *slog.Logger) *Writer {
	return &Writer{DB: db, Hub: hub, Logger: logger}
}

// Entry is a notification to create.
type Entry struct {
	UserID       string
	Type         string
	Title        string
	Body         string
	ResourceType string
	ResourceID   string // UUID string or empty
}

// Write inserts a notification row and publishes a WS event to notify
// the recipient. Errors are logged but not returned (fire-and-forget).
func (w *Writer) Write(ctx context.Context, e Entry) {
	const sqlText = `
		INSERT INTO notifications (user_id, type, title, body, resource_type, resource_id)
		VALUES ($1::uuid, $2, $3, $4, $5, $6)
		RETURNING id::text
	`
	var notifID string
	err := w.DB.QueryRow(ctx, sqlText,
		e.UserID, e.Type, e.Title,
		nilStr(e.Body), nilStr(e.ResourceType), nullUUID(e.ResourceID),
	).Scan(&notifID)
	if err != nil {
		w.Logger.Warn("notification write failed",
			slog.String("type", e.Type),
			slog.String("user_id", e.UserID),
			slog.String("error", err.Error()),
		)
		return
	}

	if w.Hub != nil {
		w.Hub.Publish(ws.NewEvent(ws.EventNotificationCreated, notifID, "system"))
	}
}

// WriteAsync calls Write in a goroutine (for use in hot-path handlers).
func (w *Writer) WriteAsync(e Entry) {
	go w.Write(context.Background(), e)
}

func nilStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}
