-- +goose Up
-- +goose StatementBegin

-- PR-SEARCH: Plaintext normalized name column for substring search.
--
-- Güvenlik notu: items.name metadata (not a secret field). Server envelope
-- encryption sağlar (server zaten master key ile şifre çözüyor; ADR-0002 §1).
-- name_plain = lower(name) — case-insensitive ILIKE araması için yeterli.
-- Mevcut item'lar için NULL; startup backfill goroutine'i doldurur.

ALTER TABLE items ADD COLUMN name_plain TEXT;

-- ILIKE '%term%' için leading-wildcard index trigram olmadan tam etkili değil,
-- ama küçük-orta kurulumlar (<100k item) için sequential scan kabul edilebilir.
-- Büyük kurulumlar için: CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX ... USING gin(name_plain gin_trgm_ops);
CREATE INDEX idx_items_name_plain ON items (name_plain);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_items_name_plain;
ALTER TABLE items DROP COLUMN IF EXISTS name_plain;
-- +goose StatementEnd
