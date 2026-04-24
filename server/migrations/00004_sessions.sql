-- +goose Up
-- +goose StatementBegin

-- Oturum tablosu. Her aktif refresh token bir row.
-- refresh_token_hash: SHA-256(refresh_token). Token plaintext asla saklanmaz.
-- user_agent + ip_address: session binding için — değişirse flag (audit log), block değil.
--
-- Lifecycle:
--   - Login → row oluşturulur (revoked_at=NULL, expires_at=+7g)
--   - Refresh → mevcut row revoked_at=now, revoke_reason='rotation'; yeni row
--   - Logout → revoked_at=now, revoke_reason='logout'
--   - Password change / recovery → tüm user session'ları revoke ('admin' veya 'recovery')
--   - Reuse detection → 'reuse_detected' (tüm session'lar revoke)
--
-- Bkz. docs/auth-flow.md Senaryo 3-6.

CREATE TABLE sessions (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid         NOT NULL,
    refresh_token_hash  bytea        NOT NULL,
    user_agent          text,
    ip_address          inet,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    last_used_at        timestamptz  NOT NULL DEFAULT now(),
    expires_at          timestamptz  NOT NULL,
    revoked_at          timestamptz,
    revoke_reason       text,

    CONSTRAINT sessions_refresh_hash_uniq UNIQUE (refresh_token_hash),
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT sessions_revoke_reason_chk CHECK (
        revoke_reason IS NULL OR revoke_reason IN (
            'logout', 'logout_all', 'rotation', 'admin', 'expired', 'recovery', 'reuse_detected'
        )
    ),
    CONSTRAINT sessions_revoked_consistency_chk CHECK (
        (revoked_at IS NULL AND revoke_reason IS NULL) OR
        (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
    ),
    CONSTRAINT sessions_hash_len_chk CHECK (octet_length(refresh_token_hash) = 32)  -- SHA-256 = 32B
);

-- Aktif session lookup (refresh token verify): "WHERE refresh_token_hash=? AND revoked_at IS NULL"
-- unique constraint'ten index geldi, ek partial index gereksiz.

-- Kullanıcının aktif session'larını listele (örn: devices ekranı, logout-all).
CREATE INDEX idx_sessions_user_active
    ON sessions (user_id)
    WHERE revoked_at IS NULL;

-- Expired session temizliği (cron / background job) için.
CREATE INDEX idx_sessions_expires
    ON sessions (expires_at)
    WHERE revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_sessions_expires;
DROP INDEX IF EXISTS idx_sessions_user_active;
DROP TABLE IF EXISTS sessions;

-- +goose StatementEnd
