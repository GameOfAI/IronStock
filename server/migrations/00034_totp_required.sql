-- +goose Up
-- PR-SEC1: Per-user TOTP enforcement.
--
-- Şu ana kadar TOTP herkes için zorunluydu (auth_totp.go verify
-- endpoint'i users.status='pending_totp'→'active' geçişini yapıyor).
-- Yeni flag ile admin per-user kapatıp açabilir:
--   * true  → kullanıcı TOTP kurmadan login olamaz (mevcut davranış)
--   * false → kullanıcı sadece şifreyle login olur
--
-- Default true: mevcut kullanıcılar etkilenmez, geriye dönük uyumlu.
-- Bootstrap admin ensureDefaultAdmin'de explicit true ile oluşturulur.

ALTER TABLE users ADD COLUMN totp_required BOOLEAN NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS totp_required;
