-- +goose Up
-- +goose StatementBegin

-- Item categorization (server, url, database, ssh_key, certificate, ...).
-- Bkz. ADR-0006 §1.
-- Tablo (enum değil) çünkü admin yeni tip ekleyebilir migration'sız.
-- suggested_fields: item oluşturma form'unda default field listesi (UI hint).
-- default_launchers: Faz 4 client tarafında "SSH aç", "Browser aç" gibi.

CREATE TABLE item_types (
    id                smallserial  PRIMARY KEY,
    key               text         NOT NULL,
    label             text         NOT NULL,
    icon              text,
    suggested_fields  jsonb        NOT NULL DEFAULT '[]'::jsonb,
    default_launchers jsonb        NOT NULL DEFAULT '[]'::jsonb,
    created_by        uuid,
    created_at        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT item_types_key_uniq UNIQUE (key),
    CONSTRAINT fk_item_types_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT item_types_key_len_chk
        CHECK (char_length(key) BETWEEN 2 AND 64),
    CONSTRAINT item_types_key_format_chk
        CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

-- Seed: 8 tip. ADR-0006 §1.
INSERT INTO item_types (key, label, icon, suggested_fields) VALUES
    ('server',           'Sunucu',           'server',
     '["hostname","ip_address","ssh_port","username","password","root_password","os","cpu","ram_gb","disk_gb","environment"]'::jsonb),
    ('url',              'URL / Web',        'globe',
     '["url","username","password","notes","environment"]'::jsonb),
    ('database',         'Veritabanı',       'database',
     '["host","port","db_name","db_type","username","password","environment"]'::jsonb),
    ('ssh_key',          'SSH Key',          'key',
     '["hostname","username","ssh_private_key","ssh_passphrase","fingerprint"]'::jsonb),
    ('certificate',      'Sertifika',        'shield-check',
     '["hostname","cert_pem","private_key","expires_at","issuer"]'::jsonb),
    ('cloud_credential', 'Cloud Credential', 'cloud',
     '["provider","access_key","secret_key","region","account_id"]'::jsonb),
    ('note',             'Not',              'file-text',
     '["notes"]'::jsonb),
    ('generic',          'Genel',            'box',
     '[]'::jsonb);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS item_types;
-- +goose StatementEnd
