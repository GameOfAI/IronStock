-- sqlc queries: roles + user_roles

-- name: ListRoles :many
SELECT * FROM roles ORDER BY id;

-- name: GrantRole :exec
INSERT INTO user_roles (user_id, role_id, granted_by)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- name: RevokeRole :exec
DELETE FROM user_roles
WHERE user_id = $1 AND role_id = $2;

-- name: ListUserRoles :many
SELECT r.id, r.name, r.description, ur.granted_at, ur.granted_by
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE ur.user_id = $1
ORDER BY r.id;

-- name: HasRole :one
SELECT EXISTS(
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = $1 AND r.name = $2
) AS has_role;
