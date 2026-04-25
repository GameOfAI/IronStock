-- +goose Up
-- +goose StatementBegin

-- Typed relationships between items.
-- Bkz. ADR-0006 §5. 5 edge type:
--   hosted_on:    DB → server     (hangi sunucuda çalışıyor)
--   accessed_via: prod → jump     (jump server zinciri — Faz 4 SSH komutu otomatik)
--   part_of:      DB → project    (mantıksal grup item'ı)
--   related_to:   generic         ("ilgili kayıtlar")
--   depends_on:   web → redis     (servis bağımlılığı)
--
-- metadata: edge'e özgü context — örn: accessed_via için { "ssh_user": "jumpadm" }

CREATE TABLE item_relationships (
    source_item_id     uuid         NOT NULL,
    target_item_id     uuid         NOT NULL,
    relationship_type  text         NOT NULL,
    metadata           jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_by         uuid,
    created_at         timestamptz  NOT NULL DEFAULT now(),

    PRIMARY KEY (source_item_id, target_item_id, relationship_type),

    CONSTRAINT fk_item_rel_source
        FOREIGN KEY (source_item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_rel_target
        FOREIGN KEY (target_item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_rel_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT item_rel_type_chk
        CHECK (relationship_type IN ('hosted_on', 'accessed_via', 'part_of', 'related_to', 'depends_on')),
    CONSTRAINT item_rel_self_loop_chk
        CHECK (source_item_id <> target_item_id)
);

-- Reverse-traversal: "bu sunucuya bağlanan item'lar" / "bu jump server'dan geçenler".
CREATE INDEX idx_item_rel_target_type
    ON item_relationships (target_item_id, relationship_type);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_item_rel_target_type;
DROP TABLE IF EXISTS item_relationships;
-- +goose StatementEnd
