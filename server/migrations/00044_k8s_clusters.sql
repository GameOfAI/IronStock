-- +goose Up
CREATE TABLE k8s_clusters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
    server_url      TEXT NOT NULL,
    auth_mode       TEXT NOT NULL CHECK (auth_mode IN ('token', 'kubeconfig')),
    token_enc       BYTEA,
    kubeconfig_enc  BYTEA,
    ca_cert_pem     TEXT,
    skip_tls_verify BOOLEAN NOT NULL DEFAULT false,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

CREATE TRIGGER trg_k8s_clusters_updated_at
    BEFORE UPDATE ON k8s_clusters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TRIGGER IF EXISTS trg_k8s_clusters_updated_at ON k8s_clusters;
DROP TABLE IF EXISTS k8s_clusters;
