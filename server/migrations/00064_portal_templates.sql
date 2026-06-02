-- +goose Up
-- Portal templates for the Golden Path wizard (PR-DP11).
-- Separate from item_templates (credential templates) — these define entity
-- scaffolding blueprints with default kind, annotations, lifecycle stages, and relations.
CREATE TABLE portal_templates (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT        NOT NULL,
    description            TEXT,
    kind_key               TEXT        NOT NULL,
    item_type_id           SMALLINT    REFERENCES item_types(id),
    default_fields         JSONB,
    default_annotations    JSONB,
    default_lifecycle_stages TEXT[],
    default_relations      JSONB,
    is_builtin             BOOLEAN     NOT NULL DEFAULT false,
    is_active              BOOLEAN     NOT NULL DEFAULT true,
    created_by             UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portal_templates_kind_key ON portal_templates (kind_key);
CREATE INDEX idx_portal_templates_active   ON portal_templates (is_active);

-- 4 built-in seed templates
INSERT INTO portal_templates (name, description, kind_key, is_builtin) VALUES
    ('Server',          'Fiziksel veya sanal sunucu',          'Server',     true),
    ('Database',        'Veritabanı bağlantı bilgileri',       'Database',   true),
    ('Service',         'Web servisi, API veya uygulama',      'Service',    true),
    ('Certificate',     'TLS/SSL veya kod imzalama sertifikası','Certificate',true);

-- +goose Down
DROP TABLE IF EXISTS portal_templates;
