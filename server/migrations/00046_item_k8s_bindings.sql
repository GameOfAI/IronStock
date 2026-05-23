-- +goose Up
-- item_k8s_bindings stores the server-readable K8s cluster + namespace binding
-- for k8s_namespace items. Item field values are client-side E2E encrypted and
-- the server cannot decrypt them, so operational metadata needed for live K8s
-- queries is stored here in plaintext (these are non-secret identifiers).
--
-- A binding is created/updated by the item owner or admin via:
--   POST /api/v1/items/{id}/k8s/bind  { "cluster_id": "...", "namespace_name": "..." }
CREATE TABLE item_k8s_bindings (
    item_id        UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    cluster_id     UUID NOT NULL REFERENCES k8s_clusters(id) ON DELETE RESTRICT,
    namespace_name TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_item_k8s_bindings_updated_at
    BEFORE UPDATE ON item_k8s_bindings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TRIGGER IF EXISTS trg_item_k8s_bindings_updated_at ON item_k8s_bindings;
DROP TABLE IF EXISTS item_k8s_bindings;
