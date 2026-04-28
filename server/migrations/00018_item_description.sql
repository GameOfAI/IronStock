-- +goose Up
-- +goose StatementBegin

-- Plaintext description/notes field for items. Stored server-side as TEXT
-- (not client-E2E encrypted) — it's metadata, not a secret credential.
-- NULL means "no description" (existing rows keep NULL after migration).

ALTER TABLE items ADD COLUMN description TEXT;

-- +goose Down
-- +goose StatementBegin
ALTER TABLE items DROP COLUMN IF EXISTS description;
-- +goose StatementEnd
