-- PR-SEC4: WebAuthn / FIDO2 credential store
-- Each row is one registered hardware key / passkey for a user.

-- +goose Up

CREATE TABLE user_webauthn_credentials (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Raw credential ID bytes from the authenticator (base64url encoded in CTAP)
    credential_id BYTEA NOT NULL UNIQUE,
    public_key   BYTEA NOT NULL,
    -- Counter for clone-detection (monotonically increasing per key use)
    sign_count   BIGINT NOT NULL DEFAULT 0,
    -- JSON array of AuthenticatorTransport values ("usb","nfc","ble","internal")
    transports   TEXT[] NOT NULL DEFAULT '{}',
    -- AAGUID (16-byte UUID) identifies authenticator model
    aaguid       UUID,
    -- Human-readable label the user sets (e.g. "YubiKey 5 NFC")
    label        TEXT NOT NULL DEFAULT 'Güvenlik Anahtarı',
    -- Whether UV (user verification) is required for this credential
    uv_required  BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_webauthn_user ON user_webauthn_credentials (user_id);

-- Optional admin control: per-user "WebAuthn required" flag
ALTER TABLE users ADD COLUMN webauthn_required BOOLEAN NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE users DROP COLUMN IF EXISTS webauthn_required;
DROP TABLE IF EXISTS user_webauthn_credentials;
