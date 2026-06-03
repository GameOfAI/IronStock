-- +goose Up
-- +goose StatementBegin

-- PR-SEARCH-FT: Trigram search for item names and descriptions.
--
-- pg_trgm enables similarity-based fuzzy search.
-- GIN indexes on name_plain + description accelerate ILIKE / similarity queries.
-- Field values are E2E encrypted and therefore UNSEARCHABLE by design (ADR-0004).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on decrypted item name (name_plain is stored server-side for search).
-- Items without name_plain (migrated from encrypted-only) will be missing from trigram
-- results until their name_plain is populated.
CREATE INDEX IF NOT EXISTS idx_items_name_plain_trgm
    ON items USING gin (name_plain gin_trgm_ops)
    WHERE name_plain IS NOT NULL;

-- GIN trigram index on item description.
CREATE INDEX IF NOT EXISTS idx_items_description_trgm
    ON items USING gin (description gin_trgm_ops)
    WHERE description IS NOT NULL;

-- GIN trigram index on tag name for tag search.
-- Allows fuzzy tag matching in item search results.
CREATE INDEX IF NOT EXISTS idx_tags_name_trgm
    ON tags USING gin (name gin_trgm_ops);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_tags_name_trgm;
DROP INDEX IF EXISTS idx_items_description_trgm;
DROP INDEX IF EXISTS idx_items_name_plain_trgm;
-- Note: we intentionally do NOT drop the pg_trgm extension on rollback
-- because other parts of the schema may depend on it.

-- +goose StatementEnd
