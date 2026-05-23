-- +goose Up
-- +goose StatementBegin

-- PR-SIEM: Extend log_forwarding_configs to support Splunk HEC and Elastic ECS.
-- PostgreSQL CHECK constraints cannot be altered in-place; recreate via ALTER TABLE.

ALTER TABLE log_forwarding_configs
    DROP CONSTRAINT IF EXISTS log_forwarding_configs_target_type_check;

ALTER TABLE log_forwarding_configs
    ADD CONSTRAINT log_forwarding_configs_target_type_check
    CHECK (target_type IN ('syslog', 'slack', 'splunk', 'elastic'));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE log_forwarding_configs
    DROP CONSTRAINT IF EXISTS log_forwarding_configs_target_type_check;

ALTER TABLE log_forwarding_configs
    ADD CONSTRAINT log_forwarding_configs_target_type_check
    CHECK (target_type IN ('syslog', 'slack'));

-- +goose StatementEnd
