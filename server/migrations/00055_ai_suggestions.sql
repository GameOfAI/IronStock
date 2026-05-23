-- +goose Up
-- +goose StatementBegin

-- PR-AI: AI-generated tag and relationship suggestions per item.
-- Server sends item name + description + tags + type to LLM (NO field values —
-- they are E2E encrypted and inaccessible). Suggestions are stored here so the
-- user can accept or reject them from the UI.

CREATE TABLE ai_suggestions (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id          uuid         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    suggestion_type  TEXT         NOT NULL CHECK (suggestion_type IN ('tag', 'relationship')),
    payload          JSONB        NOT NULL,
    -- e.g. {"tag_label": "production"} or {"target_name": "db-server", "rel_type": "depends_on"}
    accepted_at      TIMESTAMPTZ,
    rejected_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- An item can have at most one pending (non-accepted, non-rejected) suggestion
    -- per type+payload combination to avoid duplicates from repeated /suggest calls.
    CONSTRAINT ai_suggestions_uniq UNIQUE (item_id, suggestion_type, payload)
);

-- Index to efficiently list pending suggestions for an item.
CREATE INDEX idx_ai_suggestions_item ON ai_suggestions (item_id)
    WHERE accepted_at IS NULL AND rejected_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_ai_suggestions_item;
DROP TABLE IF EXISTS ai_suggestions;
-- +goose StatementEnd
