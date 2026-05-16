-- +goose Up
-- +goose StatementBegin

-- Break-glass / emergency access (PR-N4).
-- A break-glass account is a special admin whose every login is considered
-- an emergency event: all admins are notified immediately (in-app + WS alert).
--
-- Rules:
--   - is_break_glass users must still authenticate normally (password + TOTP).
--   - Every successful login triggers auth.break_glass audit + WS alert.
--   - Normal UI blocks break-glass from routine use (honour-system guard).

ALTER TABLE users ADD COLUMN is_break_glass BOOLEAN NOT NULL DEFAULT false;

-- Only admins can be break-glass accounts (enforced at creation time by
-- the application layer; the DB has no FK to roles because role-to-user
-- is many-to-many via user_roles).
CREATE INDEX idx_users_break_glass ON users (is_break_glass) WHERE is_break_glass = true;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_users_break_glass;
ALTER TABLE users DROP COLUMN IF EXISTS is_break_glass;

-- +goose StatementEnd
