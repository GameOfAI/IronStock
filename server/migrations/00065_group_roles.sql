-- +goose Up
-- +goose StatementBegin

-- Add optional global role to groups.
-- When set, all members of the group inherit this role in their JWT claims
-- (resolved at login/token-refresh via fetchUserRoles).
ALTER TABLE groups
    ADD COLUMN role TEXT CHECK (role IN ('admin', 'write', 'read'));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE groups DROP COLUMN IF EXISTS role;
-- +goose StatementEnd
