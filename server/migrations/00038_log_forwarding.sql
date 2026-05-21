-- +goose Up
-- Log forwarding configuration table (PR-LOG1).
-- Stores syslog (UDP/TCP) and Slack webhook targets for audit events.
CREATE TABLE log_forwarding_configs (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
    name        TEXT        NOT NULL,
    target_type TEXT        NOT NULL CHECK (target_type IN ('syslog', 'slack')),
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    config      JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_log_forwarding_enabled ON log_forwarding_configs(enabled) WHERE enabled = true;

CREATE TRIGGER set_log_forwarding_updated_at
    BEFORE UPDATE ON log_forwarding_configs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TRIGGER IF EXISTS set_log_forwarding_updated_at ON log_forwarding_configs;
DROP INDEX IF EXISTS idx_log_forwarding_enabled;
DROP TABLE IF EXISTS log_forwarding_configs;
