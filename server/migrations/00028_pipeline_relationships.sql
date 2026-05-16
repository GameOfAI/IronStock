-- +goose Up
-- +goose StatementBegin

-- Extend item relationship types for DevOps pipeline mapping (PR-F5a).
-- New types: uses_tool, builds_to, scans_with, deploys_to.
-- Strategy: drop + recreate CHECK constraint (PG doesn't support inline ALTER).

ALTER TABLE item_relationships DROP CONSTRAINT item_rel_type_chk;

ALTER TABLE item_relationships
    ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on',
        'accessed_via',
        'part_of',
        'related_to',
        'depends_on',
        'uses_tool',
        'builds_to',
        'scans_with',
        'deploys_to'
    ));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE item_relationships DROP CONSTRAINT item_rel_type_chk;

ALTER TABLE item_relationships
    ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on',
        'accessed_via',
        'part_of',
        'related_to',
        'depends_on'
    ));

-- +goose StatementEnd
