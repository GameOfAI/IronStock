-- +goose Up
-- +goose StatementBegin

-- Global RBAC rolleri. Şimdilik 2 rol: read, write.
-- Item-level paylaşımda ayrıca her item_share kendi permission'u taşır (ileride).
-- Effective permission = min(global_role, item_share_permission).
--
-- Bkz. docs/auth-flow.md "RBAC Policy Matrix".

CREATE TABLE roles (
    id           smallint    PRIMARY KEY,
    name         text        NOT NULL,
    description  text        NOT NULL,

    CONSTRAINT roles_name_uniq UNIQUE (name)
);

-- Seed data. ID'ler sabit (ADR kararı): migration veya code'da hard-code edilebilir.
-- 3-katmanlı yetkilendirme: bkz. ADR-0006 §4.
INSERT INTO roles (id, name, description) VALUES
    (1, 'read',  'Envanter görüntüleme yetkisi — explicit folder/item izni gerekir'),
    (2, 'write', 'Envanter oluşturma, düzenleme, silme, paylaşım — yetkili klasör/item üzerinde'),
    (3, 'admin', 'Global admin: kullanıcı yönetimi + audit log + tüm envantere erişim (folder/item izinlerini bypass eder)');

-- Kullanıcı-rol eşleştirmesi (many-to-many).
-- ON DELETE CASCADE: kullanıcı silinirse eşleştirmeleri kalmaz.
-- roles'a ON DELETE RESTRICT: rol tablosu hiç silinmez (seed).
CREATE TABLE user_roles (
    user_id     uuid         NOT NULL,
    role_id     smallint     NOT NULL,
    granted_at  timestamptz  NOT NULL DEFAULT now(),
    granted_by  uuid,

    PRIMARY KEY (user_id, role_id),

    CONSTRAINT fk_user_roles_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_roles_granted_by
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Role'e göre kullanıcı listeleme (örn: tüm admin'ler kimler).
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_user_roles_role;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;

-- +goose StatementEnd
