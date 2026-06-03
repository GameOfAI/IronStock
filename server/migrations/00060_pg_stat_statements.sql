-- +goose Up
-- PR-PROD5: pg_stat_statements — sorgu performans izleme
-- NOT: shared_preload_libraries = 'pg_stat_statements' postgresql.conf'ta gereklidir.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- +goose Down
DROP EXTENSION IF EXISTS pg_stat_statements;
