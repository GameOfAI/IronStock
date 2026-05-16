-- +goose Up
-- +goose StatementBegin

-- Credential expiry + rotation tracking (PR-N1).
-- expires_at: absolute expiry timestamp (certificate, license key, temp password, etc.)
-- rotation_interval_days: "rotate every N days" policy for passwords/API keys
-- last_rotated_at: set by the client when rotation is recorded

ALTER TABLE items ADD COLUMN expires_at            timestamptz;
ALTER TABLE items ADD COLUMN rotation_interval_days integer CHECK (rotation_interval_days IS NULL OR rotation_interval_days > 0);
ALTER TABLE items ADD COLUMN last_rotated_at        timestamptz;

-- Partial index for efficient "find expiring soon" queries.
CREATE INDEX idx_items_expires_at ON items (expires_at)
    WHERE expires_at IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_items_expires_at;
ALTER TABLE items DROP COLUMN IF EXISTS last_rotated_at;
ALTER TABLE items DROP COLUMN IF EXISTS rotation_interval_days;
ALTER TABLE items DROP COLUMN IF EXISTS expires_at;

-- +goose StatementEnd
