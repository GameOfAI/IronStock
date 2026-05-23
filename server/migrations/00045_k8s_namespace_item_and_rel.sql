-- +goose Up
-- +goose StatementBegin
INSERT INTO item_types (key, label, icon, suggested_fields) VALUES
    ('k8s_namespace', 'K8s Namespace', 'layers',
     '["cluster_id","namespace_name","environment"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE item_relationships DROP CONSTRAINT IF EXISTS item_rel_type_chk;
ALTER TABLE item_relationships ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on','accessed_via','part_of','related_to','depends_on',
        'uses_tool','builds_to','scans_with','deploys_to','runs_in'
    ));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM item_types WHERE key = 'k8s_namespace';

ALTER TABLE item_relationships DROP CONSTRAINT IF EXISTS item_rel_type_chk;
ALTER TABLE item_relationships ADD CONSTRAINT item_rel_type_chk
    CHECK (relationship_type IN (
        'hosted_on','accessed_via','part_of','related_to','depends_on',
        'uses_tool','builds_to','scans_with','deploys_to'
    ));
-- +goose StatementEnd
