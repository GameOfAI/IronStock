-- +goose Up
-- +goose StatementBegin

-- Centralized field dictionary. hostname/host_name drift'ini engeller.
-- Bkz. ADR-0006 §2.
-- is_secret: true -> item_fields.value_enc client-side E2E (ADR-0004 §5)
--            false -> server-side envelope (ADR-0004 §6)

CREATE TABLE field_definitions (
    id                bigserial    PRIMARY KEY,
    key               text         NOT NULL,
    label             text         NOT NULL,
    field_type        text         NOT NULL,
    allowed_values    jsonb,       -- field_type='enum' için array; diğerlerinde NULL
    is_secret         boolean      NOT NULL,
    hint              text,
    validation_regex  text,
    created_by        uuid,
    created_at        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT field_def_key_uniq UNIQUE (key),
    CONSTRAINT fk_field_def_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT field_def_key_format_chk
        CHECK (key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT field_def_type_chk
        CHECK (field_type IN ('text','password','url','number','boolean','multiline','ip','port','email','ssh_key','enum')),
    CONSTRAINT field_def_enum_values_chk
        CHECK (
            (field_type = 'enum' AND allowed_values IS NOT NULL AND jsonb_typeof(allowed_values) = 'array')
            OR (field_type <> 'enum' AND allowed_values IS NULL)
        )
);

-- Seed: ADR-0006 §2 + cloud + cert ek field'lar.
INSERT INTO field_definitions (key, label, field_type, is_secret, hint, allowed_values) VALUES
    ('hostname',         'Hostname',           'text',     false, 'FQDN veya kısa ad',  NULL),
    ('ip_address',       'IP Address',         'ip',       false, 'IPv4 veya IPv6',     NULL),
    ('port',             'Port',               'port',     false, '1-65535',            NULL),
    ('username',         'Kullanıcı Adı',      'text',     false, NULL,                 NULL),
    ('password',         'Şifre',              'password', true,  NULL,                 NULL),
    ('root_password',    'Root Password',      'password', true,  NULL,                 NULL),
    ('ssh_port',         'SSH Port',           'port',     false, 'default 22',         NULL),
    ('ssh_private_key',  'SSH Private Key',    'ssh_key',  true,  'PEM formatında',     NULL),
    ('ssh_passphrase',   'SSH Passphrase',     'password', true,  NULL,                 NULL),
    ('fingerprint',      'SSH Fingerprint',    'text',     false, 'sha256:... formatı', NULL),
    ('url',              'URL',                'url',      false, NULL,                 NULL),
    ('host',             'Host',               'text',     false, 'DB/URL bileşeni',    NULL),
    ('db_name',          'Database Adı',       'text',     false, NULL,                 NULL),
    ('db_type',          'Database Türü',      'enum',     false, NULL,
        '["postgres","mysql","mongo","redis","mssql","oracle","elasticsearch"]'::jsonb),
    ('cpu',              'CPU',                'text',     false, '"8 vCPU / Intel Xeon"', NULL),
    ('ram_gb',           'RAM (GB)',           'number',   false, NULL,                 NULL),
    ('disk_gb',          'Disk (GB)',          'number',   false, 'toplam veya tek disk', NULL),
    ('os',               'İşletim Sistemi',    'text',     false, '"Ubuntu 22.04"',     NULL),
    ('cert_pem',         'Sertifika (PEM)',    'multiline', false, 'BEGIN CERTIFICATE...', NULL),
    ('private_key',      'Private Key',        'multiline', true,  NULL,                NULL),
    ('expires_at',       'Bitiş Tarihi',       'text',     false, 'ISO 8601',           NULL),
    ('issuer',           'Issuer',             'text',     false, NULL,                 NULL),
    ('provider',         'Provider',           'enum',     false, NULL,
        '["aws","gcp","azure","digitalocean","hetzner","linode","other"]'::jsonb),
    ('access_key',       'Access Key',         'text',     false, NULL,                 NULL),
    ('secret_key',       'Secret Key',         'password', true,  NULL,                 NULL),
    ('region',           'Region',             'text',     false, NULL,                 NULL),
    ('account_id',       'Account ID',         'text',     false, NULL,                 NULL),
    ('environment',      'Ortam',              'enum',     false, NULL,
        '["prod","stage","test","dev","lab"]'::jsonb),
    ('criticality',      'Kritiklik',          'enum',     false, NULL,
        '["critical","high","medium","low"]'::jsonb),
    ('notes',            'Notlar',             'multiline', false, NULL,                NULL);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS field_definitions;
-- +goose StatementEnd
