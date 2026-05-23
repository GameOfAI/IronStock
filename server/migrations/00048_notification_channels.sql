-- Migration 00048: per-user notification channel preferences
-- PR-NOTIFY: Email SMTP + Slack/Teams bildirim kanalları

-- +goose Up

-- Per-user tercih: hangi notification_type hangi kanaldan gitsin
CREATE TABLE user_notification_prefs (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'access_request', 'share_added', 'credential_expiring',
        'security_alert', 'mention', 'system_announcement', 'break_glass_alert'
    )),
    channels          TEXT[] NOT NULL DEFAULT ARRAY['inapp'],  -- inapp | email | slack | teams
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_type)
);

-- Per-user webhook endpoints (Slack / Teams)
-- Webhook URL şifreli — AAD pattern (Cipher.Seal ürettiği self-contained blob)
CREATE TABLE user_external_channels (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type     TEXT NOT NULL CHECK (channel_type IN ('slack', 'teams')),
    webhook_url_enc  BYTEA NOT NULL,   -- Cipher.Seal(url, aad) — nonce blob içinde
    channel_name     TEXT NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT true,
    last_used_at     TIMESTAMPTZ,
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uec_user_id ON user_external_channels(user_id);

-- +goose Down
DROP TABLE IF EXISTS user_external_channels;
DROP TABLE IF EXISTS user_notification_prefs;
