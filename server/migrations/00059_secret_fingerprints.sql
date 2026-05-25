-- +goose Up
-- +goose StatementBegin

-- PR-SCAN: Secret scanning / leak detection via HMAC fingerprints.
--
-- The client computes SHA-256(plain_field_value) and stores the fingerprint here.
-- External tools (GitHub Actions, pre-commit hooks) compute SHA-256 of found strings
-- and POST to /api/v1/security/scan — the server checks against these fingerprints.
-- The server NEVER sees plaintext field values (E2E encrypted). Only the fingerprint.
--
-- scan_enabled = false keeps the fingerprint registered but skips matching.

CREATE TABLE secret_fingerprints (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         uuid         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    field_def_id    bigint       REFERENCES field_definitions(id) ON DELETE CASCADE,
    fingerprint     bytea        NOT NULL,   -- SHA-256(plain_value), 32 bytes
    scan_enabled    boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT secret_fingerprints_fp_uniq UNIQUE (fingerprint)
);

CREATE INDEX idx_secret_fingerprints_item ON secret_fingerprints (item_id);
CREATE INDEX idx_secret_fingerprints_enabled ON secret_fingerprints (fingerprint)
    WHERE scan_enabled = true;

CREATE TRIGGER trg_secret_fingerprints_updated_at
    BEFORE UPDATE ON secret_fingerprints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Extend api_tokens scope to allow 'scan' (used by GitHub Action / pre-commit hook).
ALTER TABLE api_tokens
    DROP CONSTRAINT IF EXISTS api_tokens_scope_check;

ALTER TABLE api_tokens
    ADD CONSTRAINT api_tokens_scope_check
    CHECK (scope IN ('read', 'ansible', 'scim', 'scan'));

-- scan_detections tracks every confirmed match.
CREATE TABLE scan_detections (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint_id  uuid         NOT NULL REFERENCES secret_fingerprints(id) ON DELETE CASCADE,
    source_type     text         NOT NULL,   -- 'git_commit', 'file', 'message', 'manual'
    source_ref      text,                    -- commit SHA, filename, etc. (optional)
    detected_at     timestamptz  NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
);

CREATE INDEX idx_scan_detections_fp ON scan_detections (fingerprint_id);
CREATE INDEX idx_scan_detections_unack ON scan_detections (detected_at)
    WHERE acknowledged_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS scan_detections;
DROP TABLE IF EXISTS secret_fingerprints;

ALTER TABLE api_tokens
    DROP CONSTRAINT IF EXISTS api_tokens_scope_check;

ALTER TABLE api_tokens
    ADD CONSTRAINT api_tokens_scope_check
    CHECK (scope IN ('read', 'ansible', 'scim'));

-- +goose StatementEnd
