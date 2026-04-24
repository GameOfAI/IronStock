-- sqlc queries: audit_log

-- name: InsertAuditLog :exec
INSERT INTO audit_log (
    actor_user_id, action, resource_type, resource_id, details, ip_address, user_agent
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
);

-- name: ListAuditLogByUser :many
SELECT * FROM audit_log
WHERE actor_user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListAuditLogByAction :many
SELECT * FROM audit_log
WHERE action = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListAuditLogByResource :many
SELECT * FROM audit_log
WHERE resource_type = $1 AND resource_id = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: CountFailedLoginsSince :one
SELECT count(*) FROM audit_log
WHERE action = 'auth.fail'
  AND ip_address = $1
  AND created_at > $2;
