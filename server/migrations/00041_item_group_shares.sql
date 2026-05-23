-- +goose Up
-- +goose StatementBegin

-- Item-level group shares (PR-GROUP-SHARE).
--
-- Design note (E2E model):
--   Grup paylaşımında ACL ve DEK wrap ayrı katmanlardadır.
--   1. item_group_shares: Grubun erişim hakkını kaydeder (ACL; DEK yok).
--   2. Grup üyelerinin bireysel item_shares satırları hâlâ gereklidir —
--      E2E DEK her kullanıcı için ayrı wrap edilir (ADR-0004).
--   Frontend, grup paylaşımı sırasında mevcut tüm üyelerin public key'lerini
--   çekip DEK'i batch-wrap ederek item_shares'e toplu yazar.
--   Gruba sonradan eklenen kullanıcılar grup ACL üzerinden metadata görebilir;
--   E2E secret alanlar için item owner tekrar grup paylaşımı yapmalıdır.

CREATE TABLE item_group_shares (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid         NOT NULL,
    group_id    uuid         NOT NULL,
    permission  text         NOT NULL CHECK (permission IN ('read', 'write')),
    granted_by  uuid         NOT NULL,
    granted_at  timestamptz  NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    valid_from  timestamptz,          -- PR-TIME pattern ile tutarlı
    valid_until timestamptz,

    CONSTRAINT fk_igs_item
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_igs_group
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_igs_granter
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT item_group_shares_uniq
        UNIQUE (item_id, group_id),
    CONSTRAINT item_group_shares_time_window_chk
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
);

-- "Bu grubun aktif group share'leri" — ACL resolution için.
CREATE INDEX idx_igs_group_active ON item_group_shares (group_id)
    WHERE revoked_at IS NULL;

-- "Bu item hangi gruplarla paylaşılmış" — share list ekranı için.
CREATE INDEX idx_igs_item_active ON item_group_shares (item_id)
    WHERE revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_igs_item_active;
DROP INDEX IF EXISTS idx_igs_group_active;
DROP TABLE IF EXISTS item_group_shares;
-- +goose StatementEnd
