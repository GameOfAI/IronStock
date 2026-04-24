-- sqlc queries: sessions tablosu

-- name: CreateSession :one
INSERT INTO sessions (
    user_id, refresh_token_hash, user_agent, ip_address, expires_at
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetActiveSessionByTokenHash :one
SELECT * FROM sessions
WHERE refresh_token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > now()
LIMIT 1;

-- name: RevokeSession :exec
UPDATE sessions
SET revoked_at = now(), revoke_reason = $2
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :execrows
UPDATE sessions
SET revoked_at = now(), revoke_reason = $2
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: ListActiveSessionsByUser :many
SELECT * FROM sessions
WHERE user_id = $1 AND revoked_at IS NULL
ORDER BY last_used_at DESC;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = now() WHERE id = $1;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions
WHERE (expires_at < now() OR revoked_at < now() - interval '30 days');
