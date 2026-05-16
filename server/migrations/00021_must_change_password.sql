-- +goose Up
-- +goose StatementBegin

-- must_change_password: Admin tarafından oluşturulan veya ilk kurulumda seed edilen
-- kullanıcılar için zorunlu şifre değiştirme flag'i.
--
-- true olduğunda:
--   - Login response'a dahil edilir (must_change_password: true)
--   - Frontend /change-password sayfasına yönlendirir
--   - MustChangePasswordGate diğer route'lara erişimi engeller
--
-- POST /api/v1/auth/change-password başarıyla tamamlandığında false olarak sıfırlanır.

ALTER TABLE users
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;

-- +goose StatementEnd
