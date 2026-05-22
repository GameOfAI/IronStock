-- +goose Up
-- +goose StatementBegin

-- PR-TIME: Zaman bazlı erişim penceresi.
--
-- valid_from  — NULL ise hemen geçerli; doluysa bu zamandan itibaren aktif.
-- valid_until — NULL ise süresiz; doluysa bu zamanda sona erer.
-- Mevcut satırlar için her iki alan da NULL → davranış değişmez (geriye uyumlu).
--
-- Kural: valid_from < valid_until (her ikisi de doluysa).
-- Kontrol: auth/items.go ve auth/folders.go query'lerinde NOW() filtresi.

ALTER TABLE item_shares
    ADD COLUMN valid_from  TIMESTAMPTZ,
    ADD COLUMN valid_until TIMESTAMPTZ,
    ADD CONSTRAINT item_shares_time_window_chk
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until);

ALTER TABLE folder_permissions
    ADD COLUMN valid_from  TIMESTAMPTZ,
    ADD COLUMN valid_until TIMESTAMPTZ,
    ADD CONSTRAINT folder_permissions_time_window_chk
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until);

ALTER TABLE folder_group_permissions
    ADD COLUMN valid_from  TIMESTAMPTZ,
    ADD COLUMN valid_until TIMESTAMPTZ,
    ADD CONSTRAINT folder_group_permissions_time_window_chk
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE folder_group_permissions
    DROP CONSTRAINT IF EXISTS folder_group_permissions_time_window_chk,
    DROP COLUMN IF EXISTS valid_until,
    DROP COLUMN IF EXISTS valid_from;

ALTER TABLE folder_permissions
    DROP CONSTRAINT IF EXISTS folder_permissions_time_window_chk,
    DROP COLUMN IF EXISTS valid_until,
    DROP COLUMN IF EXISTS valid_from;

ALTER TABLE item_shares
    DROP CONSTRAINT IF EXISTS item_shares_time_window_chk,
    DROP COLUMN IF EXISTS valid_until,
    DROP COLUMN IF EXISTS valid_from;
-- +goose StatementEnd
