-- +goose Up
-- PR-SEC3: client certificate authority registry.
-- Supports two CA types:
--   1. Built-in: IronStock generates + stores the CA key (encrypted with master key).
--   2. External: admin uploads only the public CA cert; private key stays off-system.

CREATE TABLE client_cert_cas (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
    cert_pem        TEXT        NOT NULL,     -- public CA certificate in PEM format
    private_key_enc BYTEA,                    -- master-key envelope-encrypted ECDSA DER; NULL for external CAs
    is_builtin      BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE  client_cert_cas               IS 'PR-SEC3: certificate authorities trusted for client mTLS authentication';
COMMENT ON COLUMN client_cert_cas.private_key_enc IS 'AES-256-GCM envelope encrypted with master key; NULL for external/uploaded CAs';

-- +goose Down
DROP TABLE IF EXISTS client_cert_cas;
