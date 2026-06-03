-- +goose Up
-- PR-DP03: Add Backstage-compatible relation type aliases.
-- The five new types (camelCase) can be stored natively alongside the existing
-- snake_case types. No data migration needed — existing rows keep their types.
-- +goose StatementBegin
ALTER TABLE item_relationships DROP CONSTRAINT IF EXISTS item_rel_type_chk;
ALTER TABLE item_relationships ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on','accessed_via','part_of','related_to','depends_on',
        'uses_tool','builds_to','scans_with','deploys_to','runs_in',
        'ownedBy','dependsOn','memberOf','providesApi','consumesApi'
    ));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE item_relationships DROP CONSTRAINT IF EXISTS item_rel_type_chk;
ALTER TABLE item_relationships ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on','accessed_via','part_of','related_to','depends_on',
        'uses_tool','builds_to','scans_with','deploys_to','runs_in'
    ));
-- +goose StatementEnd
