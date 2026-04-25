-- +goose Up
-- +goose StatementBegin

-- Master password recovery codes. 10 per user, single-use.
-- Each code Argon2id-hashed (NEVER plaintext storage).
-- Bkz. ADR-0004 §9 (Recovery Codes), auth-flow.md Senaryo 8.
--
-- Recovery code kullanıldığında used_at + used_ip yazılır; aynı code
-- bir daha kullanılamaz. Tüm codes kullanılınca user reset gerekir.

CREATE TABLE recovery_codes (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL,
    code_hash   bytea        NOT NULL,
    used_at     timestamptz,
    used_ip     inet,
    created_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_recovery_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT recovery_hash_len_chk
        CHECK (octet_length(code_hash) > 0),
    CONSTRAINT recovery_used_consistency_chk
        CHECK ((used_at IS NULL AND used_ip IS NULL) OR (used_at IS NOT NULL))
);

-- Per-user lookup of unused codes (Argon2id verify hot path).
CREATE INDEX idx_recovery_codes_user_unused
    ON recovery_codes (user_id)
    WHERE used_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_recovery_codes_user_unused;
DROP TABLE IF EXISTS recovery_codes;
-- +goose StatementEnd
