-- +goose Up
-- +goose StatementBegin

-- Kullanıcılar tablosu.
-- password_hash: Argon2id output (32B). argon2_params: {"t":3,"m":65536,"p":4,"v":1}.
-- status: register sonrası 'pending_totp'; TOTP verify ile 'active'; admin disable/auto-lock ile değişir.
--
-- Güvenlik notu: password_hash ve argon2_params ayrılmıştır çünkü hash parametrelerini
-- zamanla yükseltmek mümkün (silent upgrade: login sırasında eski hash yeniden hesaplanır).
--
-- Bkz. docs/adr/0004-encryption-details.md §4, docs/auth-flow.md Senaryo 1-3.

CREATE TABLE users (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    username                text         NOT NULL,
    email                   text         NOT NULL,
    password_hash           bytea        NOT NULL,
    argon2_params           jsonb        NOT NULL,
    status                  text         NOT NULL DEFAULT 'pending_totp',
    failed_login_attempts   int          NOT NULL DEFAULT 0,
    locked_until            timestamptz,
    last_login_at           timestamptz,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT users_username_uniq    UNIQUE (username),
    CONSTRAINT users_email_uniq       UNIQUE (email),
    CONSTRAINT users_status_chk       CHECK (status IN ('pending_totp', 'active', 'disabled', 'locked')),
    CONSTRAINT users_username_len_chk CHECK (char_length(username) BETWEEN 3 AND 64),
    CONSTRAINT users_email_len_chk    CHECK (char_length(email) BETWEEN 3 AND 255),
    CONSTRAINT users_failed_attempts_nonneg CHECK (failed_login_attempts >= 0)
);

-- UNIQUE constraint'lerden ek index türemediği için performanslı lookup otomatiktir.
-- Status-bazlı sorgu sık (örn: aktif kullanıcı sayısı) — partial index.
CREATE INDEX idx_users_status_active ON users (status) WHERE status = 'active';

-- Otomatik updated_at.
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP INDEX IF EXISTS idx_users_status_active;
DROP TABLE IF EXISTS users;

-- +goose StatementEnd
