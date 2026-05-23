-- +goose Up
-- +goose StatementBegin

-- PR-SCIM: SCIM 2.0 user provisioning support.
-- Adds scim_external_id to users so Azure AD / Okta can anchor their records.
-- The column is nullable — existing (non-SCIM) users leave it NULL.

ALTER TABLE users
    ADD COLUMN scim_external_id TEXT;

CREATE UNIQUE INDEX idx_users_scim_external_id
    ON users (scim_external_id)
    WHERE scim_external_id IS NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_users_scim_external_id;
ALTER TABLE users DROP COLUMN IF EXISTS scim_external_id;

-- +goose StatementEnd
