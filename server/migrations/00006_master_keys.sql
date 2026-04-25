-- +goose Up
-- +goose StatementBegin

-- Master encryption keys (envelope encryption hierarchy root).
-- Bkz. ADR-0004 §2 (Key Hierarchy).
--
-- Sadece tek aktif master key olmalı (active=true). Rotation:
--   1. Yeni key üret, active=true ile insert (eski key'i de active=false yap)
--   2. Eski key silinmez — eski wrapped DEK'leri açmak için lazım
--   3. Background re-wrap job ile tüm wrapped_key alanlarını yeni master'a sar (Faz 5)
-- Bkz. ADR-0004 §8.1.

CREATE TABLE master_keys (
    id          smallserial  PRIMARY KEY,
    version     smallint     NOT NULL,
    -- KMS-wrapped (Faz 5) veya k8s Secret reference. Ham master key burada saklanmaz.
    wrapped_key bytea        NOT NULL,
    wrap_method text         NOT NULL,
    active      boolean      NOT NULL DEFAULT false,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    rotated_at  timestamptz,

    CONSTRAINT master_keys_version_uniq    UNIQUE (version),
    CONSTRAINT master_keys_wrap_method_chk CHECK (wrap_method IN ('kms', 'k8s-secret', 'env')),
    CONSTRAINT master_keys_version_pos_chk CHECK (version > 0),
    CONSTRAINT master_keys_wrapped_len_chk CHECK (octet_length(wrapped_key) > 0)
);

-- En fazla 1 row aktif olabilir — partial unique index.
CREATE UNIQUE INDEX master_keys_active_uniq ON master_keys (active) WHERE active;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS master_keys_active_uniq;
DROP TABLE IF EXISTS master_keys;
-- +goose StatementEnd
