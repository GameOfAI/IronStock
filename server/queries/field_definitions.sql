-- sqlc queries: field_definitions
-- Faz 2 PR-3 minimal set; auth/inventory query'leri PR-4+'da.

-- name: ListFieldDefinitions :many
SELECT * FROM field_definitions
ORDER BY key;

-- name: GetFieldDefinitionByKey :one
SELECT * FROM field_definitions
WHERE key = $1
LIMIT 1;

-- name: GetFieldDefinitionByID :one
SELECT * FROM field_definitions
WHERE id = $1
LIMIT 1;

-- name: CreateFieldDefinition :one
-- Sadece admin tarafından çağrılır (RBAC middleware).
INSERT INTO field_definitions (
    key, label, field_type, allowed_values, is_secret, hint, validation_regex, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;
