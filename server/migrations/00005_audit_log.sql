-- +goose Up
-- +goose StatementBegin

-- Audit log. Tüm yazma işlemleri + auth event'leri burada.
-- Server-side plaintext (uyumluluk ve incident response için, bkz. ADR-0002).
--
-- id: bigserial (monotonic, index-friendly). uuid v7 alternatifi var ama bigserial
--     yeterli — audit log'u cross-shard'lamaya muhtemelen gerek olmayacak.
-- actor_user_id: null = sistem (migration, cron, scheduled job).
-- action: dot-notation, "domain.verb". Örnek:
--     auth.login, auth.fail, auth.logout, auth.refresh, auth.recover, auth.password_changed,
--     auth.token_reuse_detected, auth.session_binding_anomaly,
--     user.create, user.role_grant, user.role_revoke, user.admin_reset,
--     folder.create, folder.update, folder.delete, folder.move,
--     item.create, item.update, item.delete, item.share_grant, item.share_revoke, item.rotate_dek
-- resource_type / resource_id: hangi kaynak (opsiyonel, bazı event'ler için).
-- details: action-specific structured context. PLAINTEXT SECRET İÇERMEZ.
--     Örnek: {"ip_changed_from":"1.2.3.4","ip_changed_to":"5.6.7.8"}
--     Secret alanlar için sadece referans: {"field_key":"password"}, değer yok.

CREATE TABLE audit_log (
    id              bigserial    PRIMARY KEY,
    actor_user_id   uuid,
    action          text         NOT NULL,
    resource_type   text,
    resource_id     uuid,
    details         jsonb        NOT NULL DEFAULT '{}'::jsonb,
    ip_address      inet,
    user_agent      text,
    created_at      timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_audit_log_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT audit_log_action_chk CHECK (char_length(action) BETWEEN 1 AND 128),
    CONSTRAINT audit_log_resource_type_chk CHECK (
        resource_type IS NULL OR resource_type IN (
            'user', 'session', 'role', 'folder', 'item', 'item_share', 'master_key', 'system'
        )
    )
);

-- Yaygın sorgu patterns:
--  1) Belirli user'ın tüm aktiviteleri (security review): actor_user_id + tarih
--  2) Belirli kaynak üzerinde kim ne yaptı: resource_type + resource_id
--  3) Belirli action type tarama (örn: auth.fail son 24h): action + tarih
--  4) Global timeline (admin dashboard): tarih
CREATE INDEX idx_audit_log_actor_time
    ON audit_log (actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX idx_audit_log_resource
    ON audit_log (resource_type, resource_id, created_at DESC)
    WHERE resource_id IS NOT NULL;

CREATE INDEX idx_audit_log_action_time
    ON audit_log (action, created_at DESC);

-- Global timeline için BRIN (block-range) — tarih bazlı range query'de boyut/performans dengeli.
-- Audit log tablosu hızlı büyüyebilir; BRIN büyük tabloda btree'ye göre 1000x küçüktür.
CREATE INDEX idx_audit_log_created_brin
    ON audit_log USING BRIN (created_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_audit_log_created_brin;
DROP INDEX IF EXISTS idx_audit_log_action_time;
DROP INDEX IF EXISTS idx_audit_log_resource;
DROP INDEX IF EXISTS idx_audit_log_actor_time;
DROP TABLE IF EXISTS audit_log;

-- +goose StatementEnd
