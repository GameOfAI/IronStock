-- +goose Up
-- +goose StatementBegin

-- User-specific X25519 keypair for client-side E2E secret encryption.
-- public_key: 32B X25519 public.
-- private_key_enc: priv key encrypted with KEK (Argon2id-derived from master password).
-- kek_salt + kek_params: kullanıcının KEK'ini yeniden türetmek için.
--
-- Bkz. ADR-0004 §2 (Key Hierarchy), §5 (Client E2E Flows).
-- Bir user için tek aktif keypair (PK = user_id). Master password reset edilirse
-- yeni keypair üretilir, eski keypair'in wrap'ladığı item_shares accessibility kaybedilir
-- (ADR-0004 §9).

CREATE TABLE user_keypairs (
    user_id          uuid         PRIMARY KEY,
    version          smallint     NOT NULL DEFAULT 1,
    public_key       bytea        NOT NULL,
    private_key_enc  bytea        NOT NULL,
    kek_salt         bytea        NOT NULL,
    kek_params       jsonb        NOT NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    rotated_at       timestamptz,

    CONSTRAINT fk_user_keypairs_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT user_keypairs_pubkey_len_chk
        CHECK (octet_length(public_key) = 32),
    CONSTRAINT user_keypairs_priv_len_chk
        CHECK (octet_length(private_key_enc) > 0),
    CONSTRAINT user_keypairs_salt_len_chk
        CHECK (octet_length(kek_salt) >= 16)
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_keypairs;
-- +goose StatementEnd
