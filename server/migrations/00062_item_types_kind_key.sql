-- +goose Up
-- PR-DP02: Add kind_key to item_types for Backstage-style entity kind.
-- kind_key is the string identifier used in catalog URLs and EntityEnvelope responses.
ALTER TABLE item_types ADD COLUMN IF NOT EXISTS kind_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_types_kind_key ON item_types (kind_key);

UPDATE item_types SET kind_key = CASE key
    WHEN 'server'           THEN 'Server'
    WHEN 'url'              THEN 'Service'
    WHEN 'database'         THEN 'Database'
    WHEN 'ssh_key'          THEN 'SSHKey'
    WHEN 'certificate'      THEN 'Certificate'
    WHEN 'cloud_credential' THEN 'CloudCredential'
    WHEN 'note'             THEN 'Note'
    WHEN 'generic'          THEN 'Credential'
    ELSE NULL
END;

-- +goose Down
DROP INDEX IF EXISTS idx_item_types_kind_key;
ALTER TABLE item_types DROP COLUMN IF EXISTS kind_key;
