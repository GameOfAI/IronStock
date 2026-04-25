-- +goose Up
-- +goose StatementBegin

-- Per-user item shares with wrapped E2E DEK.
-- Item paylaşıldığında her kullanıcı için DEK ayrı ayrı X25519 ile wrap edilir
-- (kullanıcının public_key'i ile). Bkz. ADR-0004 §5.5.
--
-- Permission revoke akışı: item için yeni DEK üretilir, kalan share'ler için
-- yeniden wrap edilir, eski share row revoke edilir (revoked_at). Owner client'ı
-- offline/online aktif rotation yapmalı (ADR-0004 §8.2).

CREATE TABLE item_shares (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id           uuid         NOT NULL,
    user_id           uuid         NOT NULL,
    e2e_dek_wrapped   bytea        NOT NULL,
    wrap_nonce        bytea        NOT NULL,
    permission        text         NOT NULL,
    granted_by        uuid         NOT NULL,
    granted_at        timestamptz  NOT NULL DEFAULT now(),
    revoked_at        timestamptz,

    CONSTRAINT fk_item_shares_item
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_shares_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_shares_granter
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT item_shares_perm_chk
        CHECK (permission IN ('read', 'write')),
    CONSTRAINT item_shares_uniq
        UNIQUE (item_id, user_id),
    CONSTRAINT item_shares_wrap_nonce_len_chk
        CHECK (octet_length(wrap_nonce) = 12)
);

-- "Bu user'ın aktif share'leri" — RBAC effective permission hesabında.
CREATE INDEX idx_item_shares_user_active
    ON item_shares (user_id)
    WHERE revoked_at IS NULL;

-- "Bu item kimlerle paylaşılmış" — owner share list ekranı.
CREATE INDEX idx_item_shares_item_active
    ON item_shares (item_id)
    WHERE revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_item_shares_item_active;
DROP INDEX IF EXISTS idx_item_shares_user_active;
DROP TABLE IF EXISTS item_shares;
-- +goose StatementEnd
