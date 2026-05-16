-- +goose Up
-- PR-F2b: Trusted device tokens — "remember this device for 30 days".
--
-- When a user successfully verifies TOTP and opts in to "remember device",
-- the server inserts a row here, stores a 32-byte SHA-256 token hash in
-- token_hash, and sets a HttpOnly cookie with the raw token on the client.
-- Subsequent logins from the same browser skip TOTP if a matching, non-expired
-- row is found for the authenticated user.
--
-- token_hash is BYTEA CHECK 32B so we never accidentally store the raw token.
-- expires_at is extended on each successful use (rolling 30-day window).

CREATE TABLE trusted_devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    device_label  TEXT,
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id);

-- +goose Down
DROP TABLE IF EXISTS trusted_devices;
