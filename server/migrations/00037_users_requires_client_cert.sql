-- +goose Up
-- PR-SEC3: per-user client-certificate enforcement flag.
-- When true, the login handler requires a valid (non-revoked, non-expired) client
-- certificate whose fingerprint is registered in client_certificates for this user.
-- Defaults false so all existing users are unaffected.

ALTER TABLE users ADD COLUMN requires_client_cert BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.requires_client_cert IS 'PR-SEC3: when true, login requires a trusted client certificate (mTLS layer)';

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS requires_client_cert;
