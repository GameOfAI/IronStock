-- Migration 00047: password reset tokens for self-service şifre sıfırlama
-- PR-NOTIFY: Email SMTP + Slack/Teams bildirim kanalları

-- +goose Up
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE,       -- SHA-256 of the URL token (link has plain, DB has hash)
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,                 -- NULL = unused
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prt_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_prt_expires_at ON password_reset_tokens(expires_at);

-- Email outbox for retry queue (failed emails)
CREATE TABLE email_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_address      TEXT NOT NULL,
    subject         TEXT NOT NULL,
    template_name   TEXT NOT NULL,
    template_data   JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','abandoned')),
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_outbox_status ON email_outbox(status, next_retry_at)
    WHERE status IN ('pending', 'failed');

-- +goose Down
DROP TABLE IF EXISTS email_outbox;
DROP TABLE IF EXISTS password_reset_tokens;
