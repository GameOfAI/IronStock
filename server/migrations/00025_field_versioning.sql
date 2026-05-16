-- +goose Up
-- +goose StatementBegin

-- Secret field versioning — keeps up to 10 previous values per field (PR-N2).
-- AWS Secrets Manager model: current row in item_fields, history here.
--
-- value_enc / value_nonce are the client-encrypted blobs from the old row.
-- The client uses the same DEK (from item_shares) to decrypt any version.
-- No server-side secret material is stored — blobs are opaque to the server.

CREATE TABLE item_field_versions (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_field_id  uuid         NOT NULL REFERENCES item_fields(id) ON DELETE CASCADE,
    version_number integer      NOT NULL,
    value_enc      bytea,
    value_nonce    bytea        CHECK (value_nonce IS NULL OR octet_length(value_nonce) = 12),
    changed_at     timestamptz  NOT NULL DEFAULT now(),

    UNIQUE (item_field_id, version_number)
);

-- Index for the common "latest N versions for this field" query.
CREATE INDEX idx_item_field_versions_lookup
    ON item_field_versions (item_field_id, version_number DESC);

-- Trigger: before updating a field value, snapshot the old row, prune to 10.
CREATE OR REPLACE FUNCTION fn_snapshot_item_field()
RETURNS TRIGGER AS $$
DECLARE
    next_ver integer;
BEGIN
    -- Only snapshot when the encrypted value actually changes and is not NULL.
    IF OLD.value_enc IS NULL OR OLD.value_enc = NEW.value_enc THEN
        RETURN NEW;
    END IF;

    -- Compute next version number (1-based, monotonic).
    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO next_ver
    FROM item_field_versions
    WHERE item_field_id = OLD.id;

    INSERT INTO item_field_versions (item_field_id, version_number, value_enc, value_nonce)
    VALUES (OLD.id, next_ver, OLD.value_enc, OLD.value_nonce);

    -- Prune: keep only the 10 most recent versions.
    DELETE FROM item_field_versions
    WHERE item_field_id = OLD.id
      AND version_number <= next_ver - 10;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_snapshot_item_field
BEFORE UPDATE ON item_fields
FOR EACH ROW
EXECUTE FUNCTION fn_snapshot_item_field();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TRIGGER IF EXISTS trg_snapshot_item_field ON item_fields;
DROP FUNCTION IF EXISTS fn_snapshot_item_field();
DROP INDEX IF EXISTS idx_item_field_versions_lookup;
DROP TABLE IF EXISTS item_field_versions;

-- +goose StatementEnd
