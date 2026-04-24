-- sqlc queries: users tablosu
--
-- Format: `-- name: QueryName :result_kind`
-- result_kind: :one | :many | :exec | :execrows

-- name: CreateUser :one
INSERT INTO users (
    username, email, password_hash, argon2_params, status
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1 LIMIT 1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1 LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1 LIMIT 1;

-- name: UpdateUserStatus :exec
UPDATE users SET status = $2 WHERE id = $1;

-- name: UpdateUserLastLogin :exec
UPDATE users
SET last_login_at = now(),
    failed_login_attempts = 0,
    locked_until = NULL
WHERE id = $1;

-- name: IncrementFailedLoginAttempts :one
UPDATE users
SET failed_login_attempts = failed_login_attempts + 1,
    locked_until = CASE
        WHEN failed_login_attempts + 1 >= 10 THEN now() + interval '30 minutes'
        ELSE locked_until
    END
WHERE id = $1
RETURNING failed_login_attempts, locked_until;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2, argon2_params = $3
WHERE id = $1;

-- name: ListActiveUsers :many
SELECT * FROM users
WHERE status = 'active'
ORDER BY username
LIMIT $1 OFFSET $2;
