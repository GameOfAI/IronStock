-- +goose Up
-- +goose StatementBegin

-- In-app notification system (PR-N8).
-- Notifications are created server-side (expiry warnings, admin events) and
-- pushed to the client via WS event type "notification.created".
-- The client fetches the full list from REST; WS provides the push signal.

CREATE TABLE notifications (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          text         NOT NULL,        -- expiry_warning, access_request, group_event, etc.
    title         text         NOT NULL CHECK (char_length(title) BETWEEN 1 AND 256),
    body          text,
    resource_type text,                         -- 'item', 'group', 'folder', etc.
    resource_id   uuid,
    read_at       timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX idx_notifications_user_all
    ON notifications (user_id, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_notifications_user_all;
DROP INDEX IF EXISTS idx_notifications_user_unread;
DROP TABLE IF EXISTS notifications;

-- +goose StatementEnd
