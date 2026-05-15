-- +goose Up
-- +goose StatementBegin

-- 1) CPU 'text' yerine 'number' olsun (vCPU sayısı integer).
UPDATE field_definitions
SET field_type = 'number',
    hint       = '"8" gibi vCPU sayısı'
WHERE key = 'cpu';

-- 2) IP Address için validation_regex ekle (IPv4 katı + IPv6 yumuşak).
--    IPv6 tam regex'i çok uzun; UI client-side bunu hint olarak gösterir.
UPDATE field_definitions
SET validation_regex = '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^([0-9a-fA-F:]+)$',
    hint             = 'IPv4 örn 192.168.1.10 / IPv6 örn ::1'
WHERE key = 'ip_address';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

UPDATE field_definitions
SET field_type = 'text',
    hint       = '"8 vCPU / Intel Xeon"'
WHERE key = 'cpu';

UPDATE field_definitions
SET validation_regex = NULL,
    hint             = 'IPv4 veya IPv6'
WHERE key = 'ip_address';

-- +goose StatementEnd
