-- +goose Up
-- Linked entries (PR-LINK): source field changes propagate to linked targets.
--
-- link_type:
--   'mirror'    — when source field is updated, the server records a
--                 propagation job for the client to re-encrypt targets.
--   'reference' — purely visual link; no propagation.
--
-- Both source and target must exist and be accessible to the creating user
-- (enforced at the application layer during creation).
CREATE TABLE item_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_item_id  UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_field_def_id UUID NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
    target_item_id  UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_field_def_id UUID NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
    link_type       TEXT NOT NULL CHECK (link_type IN ('mirror', 'reference')),
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Prevent duplicate links between the same field pair.
    CONSTRAINT uq_item_links UNIQUE (source_item_id, source_field_def_id, target_item_id, target_field_def_id)
);

CREATE INDEX idx_item_links_source ON item_links (source_item_id);
CREATE INDEX idx_item_links_target ON item_links (target_item_id);

-- +goose Down
DROP TABLE IF EXISTS item_links;
