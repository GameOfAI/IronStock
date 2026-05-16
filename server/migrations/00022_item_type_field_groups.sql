-- +goose Up
-- +goose StatementBegin

-- 1. Add field_groups column to item_types.
--    field_groups is an ordered array of { name: string, fields: string[] } objects.
--    When non-empty, the create-item form renders each group under a section header.
--    When empty, fields are displayed flat (legacy behaviour, backward-compatible).
ALTER TABLE item_types ADD COLUMN field_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Add ssl_mode field definition (PostgreSQL connection SSL mode enum).
INSERT INTO field_definitions (key, label, field_type, is_secret, hint, allowed_values) VALUES
    ('ssl_mode', 'SSL Modu', 'enum', false, 'Bağlantı SSL zorunluluğu',
     '["disable","allow","prefer","require","verify-ca","verify-full"]'::jsonb);

-- 3. Update server type: add provider + field_groups.
UPDATE item_types
SET suggested_fields = '["hostname","ip_address","ssh_port","username","password","root_password","os","cpu","ram_gb","disk_gb","provider","environment","criticality"]'::jsonb,
    field_groups = '[
        {"name":"Bağlantı","fields":["hostname","ip_address","ssh_port"]},
        {"name":"Kimlik","fields":["username","password","root_password"]},
        {"name":"Sistem","fields":["os","cpu","ram_gb","disk_gb"]},
        {"name":"Meta","fields":["provider","environment","criticality"]}
    ]'::jsonb
WHERE key = 'server';

-- 4. Update database type: add ssl_mode + field_groups.
UPDATE item_types
SET suggested_fields = '["host","port","db_name","db_type","username","password","ssl_mode","environment","criticality"]'::jsonb,
    field_groups = '[
        {"name":"Bağlantı","fields":["host","port","db_name","db_type","ssl_mode"]},
        {"name":"Kimlik","fields":["username","password"]},
        {"name":"Meta","fields":["environment","criticality"]}
    ]'::jsonb
WHERE key = 'database';

-- 5. Update ssh_key type: add port + field_groups.
UPDATE item_types
SET suggested_fields = '["hostname","username","ssh_private_key","ssh_passphrase","fingerprint","ssh_port"]'::jsonb,
    field_groups = '[
        {"name":"Hedef","fields":["hostname","ssh_port","username"]},
        {"name":"Anahtar","fields":["ssh_private_key","ssh_passphrase","fingerprint"]}
    ]'::jsonb
WHERE key = 'ssh_key';

-- 6. Add field_groups to url, certificate, cloud_credential types too.
UPDATE item_types
SET field_groups = '[
        {"name":"Bağlantı","fields":["url"]},
        {"name":"Kimlik","fields":["username","password"]},
        {"name":"Meta","fields":["notes","environment"]}
    ]'::jsonb
WHERE key = 'url';

UPDATE item_types
SET field_groups = '[
        {"name":"Sertifika","fields":["hostname","cert_pem","private_key","expires_at","issuer"]},
        {"name":"Meta","fields":["environment","criticality"]}
    ]'::jsonb
WHERE key = 'certificate';

UPDATE item_types
SET field_groups = '[
        {"name":"Kimlik","fields":["provider","access_key","secret_key"]},
        {"name":"Konfigürasyon","fields":["region","account_id"]},
        {"name":"Meta","fields":["environment","criticality"]}
    ]'::jsonb
WHERE key = 'cloud_credential';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM field_definitions WHERE key = 'ssl_mode';

-- Restore original suggested_fields
UPDATE item_types
SET suggested_fields = '["hostname","ip_address","ssh_port","username","password","root_password","os","cpu","ram_gb","disk_gb","environment"]'::jsonb,
    field_groups = '[]'::jsonb
WHERE key = 'server';

UPDATE item_types
SET suggested_fields = '["host","port","db_name","db_type","username","password","environment"]'::jsonb,
    field_groups = '[]'::jsonb
WHERE key = 'database';

UPDATE item_types
SET suggested_fields = '["hostname","username","ssh_private_key","ssh_passphrase","fingerprint"]'::jsonb,
    field_groups = '[]'::jsonb
WHERE key = 'ssh_key';

UPDATE item_types SET field_groups = '[]'::jsonb WHERE key IN ('url','certificate','cloud_credential');

ALTER TABLE item_types DROP COLUMN field_groups;

-- +goose StatementEnd
