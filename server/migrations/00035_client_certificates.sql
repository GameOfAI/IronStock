-- +goose Up
-- PR-SEC3: per-user issued / registered client certificates.
-- The login handler checks fingerprint_sha256 against the ssl-client-fingerprint
-- header forwarded by the nginx Ingress after TLS handshake.

CREATE TABLE client_certificates (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    ca_id              UUID        NOT NULL REFERENCES client_cert_cas(id),
    fingerprint_sha256 BYTEA       NOT NULL UNIQUE,  -- 32 bytes, SHA-256 of DER cert
    subject_cn         TEXT        NOT NULL,
    serial_number      TEXT        NOT NULL,
    not_before         TIMESTAMPTZ NOT NULL,
    not_after          TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ,                  -- NULL = active
    label              TEXT,                          -- human label e.g. "Burak's laptop"
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast fingerprint lookup on login (WHERE revoked_at IS NULL is a partial index).
CREATE INDEX idx_client_certs_fp   ON client_certificates (fingerprint_sha256) WHERE revoked_at IS NULL;
CREATE INDEX idx_client_certs_user ON client_certificates (user_id)            WHERE revoked_at IS NULL;

COMMENT ON TABLE  client_certificates                    IS 'PR-SEC3: client TLS certificates issued or registered for users';
COMMENT ON COLUMN client_certificates.fingerprint_sha256 IS 'SHA-256 fingerprint of DER-encoded cert; used for fast login lookup';
COMMENT ON COLUMN client_certificates.revoked_at         IS 'NULL = active; non-NULL = revoked (admin action)';

-- +goose Down
DROP INDEX IF EXISTS idx_client_certs_user;
DROP INDEX IF EXISTS idx_client_certs_fp;
DROP TABLE IF EXISTS client_certificates;
