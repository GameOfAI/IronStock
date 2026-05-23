-- +goose Up
-- +goose StatementBegin

-- PR-TPL: User-defined item templates.
--
-- Templates pre-fill item creation forms with default field values and tags.
-- is_public=true templates are visible to all users (read-only for non-owners).
-- Created by a user; only owner or admin can modify/delete.
--
-- fields JSONB schema (array):
--   [{field_def_key: "password", default_value: "", required: true}, ...]
-- field_def_key references field_definitions.key (NOT id, for portability).

CREATE TABLE item_templates (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description  TEXT         CHECK (char_length(description) <= 500),
    item_type_id INTEGER      NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
    fields       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    tags         TEXT[]       NOT NULL DEFAULT '{}',
    is_public    BOOLEAN      NOT NULL DEFAULT false,
    created_by   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Fast lookup by type for the gallery.
CREATE INDEX idx_item_templates_type ON item_templates (item_type_id);
-- User's own templates.
CREATE INDEX idx_item_templates_creator ON item_templates (created_by);
-- Public template listing.
CREATE INDEX idx_item_templates_public ON item_templates (is_public) WHERE is_public = true;

-- Auto-update updated_at on change.
CREATE OR REPLACE FUNCTION update_item_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_templates_updated_at
    BEFORE UPDATE ON item_templates
    FOR EACH ROW EXECUTE FUNCTION update_item_templates_updated_at();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TRIGGER IF EXISTS trg_item_templates_updated_at ON item_templates;
DROP FUNCTION IF EXISTS update_item_templates_updated_at();
DROP INDEX IF EXISTS idx_item_templates_public;
DROP INDEX IF EXISTS idx_item_templates_creator;
DROP INDEX IF EXISTS idx_item_templates_type;
DROP TABLE IF EXISTS item_templates;

-- +goose StatementEnd
