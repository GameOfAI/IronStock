-- +goose Up
-- +goose StatementBegin

-- UUID üretimi için gen_random_uuid() PG13+ stdlib'te, pgcrypto'ya ihtiyaç yok.
-- pgcrypto'yu yine de crypt()/digest() için aktif ediyoruz (ileride HMAC blind-index için gerekebilir).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ortak trigger fonksiyonu: updated_at kolonunu otomatik günceller.
-- Kullanım:
--   CREATE TRIGGER trg_<tablo>_updated_at BEFORE UPDATE ON <tablo>
--     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP FUNCTION IF EXISTS set_updated_at();
-- pgcrypto bırakılıyor (başka migration'lar kullanıyor olabilir).

-- +goose StatementEnd
