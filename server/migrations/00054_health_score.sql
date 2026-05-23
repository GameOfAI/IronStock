-- +goose Up
-- +goose StatementBegin

-- PR-HEALTH: Cache column for computed item health score (0-100).
-- The value is computed by the background scanner (expiry job) and
-- cached here so list endpoints can filter/sort without re-computing.
-- NULL means "not yet scored" — treated as 100 in the API.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS health_score SMALLINT
        CHECK (health_score IS NULL OR (health_score >= 0 AND health_score <= 100));

-- Index for the health-report query (score < threshold ORDER BY score).
CREATE INDEX IF NOT EXISTS idx_items_health_score ON items (health_score)
    WHERE health_score IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_items_health_score;
ALTER TABLE items DROP COLUMN IF EXISTS health_score;
-- +goose StatementEnd
