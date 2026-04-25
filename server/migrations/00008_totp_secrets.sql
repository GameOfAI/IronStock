-- +goose Up
-- +goose StatementBegin

-- TOTP (RFC 6238) secret per user, server-side envelope encrypted.
-- 20B raw secret -> AES-256-GCM with master_key DEK -> stored as bytea.
-- Bkz. ADR-0004 §6 (Server-Side Envelope), auth-flow.md Senaryo 2.
--
-- verified=false: kullanıcı TOTP'yi authenticator app'e ekledi ama henüz ilk
--                 6-digit kod ile doğrulamadı. status hâlâ pending_totp.
-- verified=true:  ilk kod geçti, users.status='active' yapıldı.

CREATE TABLE totp_secrets (
    user_id        uuid         PRIMARY KEY,
    secret_enc     bytea        NOT NULL,
    nonce          bytea        NOT NULL,
    master_key_id  smallint     NOT NULL,
    verified       boolean      NOT NULL DEFAULT false,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    verified_at    timestamptz,

    CONSTRAINT fk_totp_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_totp_master_key
        FOREIGN KEY (master_key_id) REFERENCES master_keys(id) ON DELETE RESTRICT,
    CONSTRAINT totp_nonce_len_chk
        CHECK (octet_length(nonce) = 12),
    CONSTRAINT totp_secret_len_chk
        CHECK (octet_length(secret_enc) > 0),
    CONSTRAINT totp_verified_consistency_chk
        CHECK ((verified = false AND verified_at IS NULL) OR (verified = true AND verified_at IS NOT NULL))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS totp_secrets;
-- +goose StatementEnd
