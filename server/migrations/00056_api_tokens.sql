-- +goose Up
-- +goose StatementBegin

-- PR-ANSIBLE: API tokens for machine-to-machine access (Ansible, Terraform, CI/CD).
-- Tokens are stored as SHA-256 hashes; the plaintext is shown to the user once.
-- scope constrains what the token can access (read-only Ansible, SCIM provisioning, etc.)

CREATE TABLE api_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,                 -- human label
    token_hash  bytea       NOT NULL UNIQUE,          -- SHA-256(plaintext token)
    scope       TEXT        NOT NULL DEFAULT 'read'   -- read|ansible|scim
                CHECK (scope IN ('read', 'ansible', 'scim')),
    expires_at  TIMESTAMPTZ,                          -- NULL = never
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_user ON api_tokens (user_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_api_tokens_user;
DROP TABLE IF EXISTS api_tokens;
-- +goose StatementEnd
