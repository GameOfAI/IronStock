-- sqlc queries: item_types

-- name: ListItemTypes :many
SELECT * FROM item_types
ORDER BY id;

-- name: GetItemTypeByKey :one
SELECT * FROM item_types
WHERE key = $1
LIMIT 1;

-- name: GetItemTypeByID :one
SELECT * FROM item_types
WHERE id = $1
LIMIT 1;

-- name: CreateItemType :one
-- Sadece admin tarafından çağrılır.
INSERT INTO item_types (
    key, label, icon, suggested_fields, default_launchers, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING *;
