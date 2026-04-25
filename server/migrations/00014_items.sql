-- +goose Up
-- +goose StatementBegin

-- Inventory items. Metadata server-side envelope encrypted; secret fields
-- in item_fields client-side E2E encrypted (ADR-0002, ADR-0004).
-- external_source: Vault gibi dış kaynak için path referansı (ADR-0007).
--
-- id: client-generated UUID v7 (ADR-0004 §5.4) — AAD pending problemi çözümü.
--     Server gen_random_uuid kullanmaz; client UUID'yi bilerek upsert eder.

CREATE TABLE items (
    id                  uuid         PRIMARY KEY,
    folder_id           uuid         NOT NULL,
    item_type_id        smallint     NOT NULL,
    name_enc            bytea        NOT NULL,
    name_nonce          bytea        NOT NULL,
    name_search         bytea        NOT NULL,
    server_dek_wrapped  bytea        NOT NULL,
    master_key_id       smallint     NOT NULL,
    -- NULL = native item (Envanter'da yaşar). Doluysa Vault/AWS/Azure path ref.
    -- Yapı: {"type":"vault","mount":"secret","path":"projeA/db","key_mapping":{...}}
    external_source     jsonb,
    created_by          uuid         NOT NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_items_folder
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_type
        FOREIGN KEY (item_type_id) REFERENCES item_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_items_master_key
        FOREIGN KEY (master_key_id) REFERENCES master_keys(id) ON DELETE RESTRICT,
    CONSTRAINT fk_items_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT items_nonce_len_chk
        CHECK (octet_length(name_nonce) = 12),
    CONSTRAINT items_search_len_chk
        CHECK (octet_length(name_search) = 16),
    CONSTRAINT items_external_source_shape_chk
        CHECK (
            external_source IS NULL
            OR (jsonb_typeof(external_source) = 'object' AND external_source ? 'type')
        )
);

-- Folder içindeki item'ları listele (ağaç UI hot path).
CREATE INDEX idx_items_folder ON items (folder_id);

-- Item type'a göre filtrele.
CREATE INDEX idx_items_type ON items (item_type_id);

-- Searchable encryption (deterministic name hash).
CREATE INDEX idx_items_name_search ON items (name_search);

-- "Bu kullanıcının oluşturduğu item'lar" — soft ownership.
CREATE INDEX idx_items_creator ON items (created_by);

-- External-source filter (Vault-backed item'lar) — partial index.
CREATE INDEX idx_items_external_type
    ON items ((external_source->>'type'))
    WHERE external_source IS NOT NULL;

CREATE TRIGGER trg_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS trg_items_updated_at ON items;
DROP INDEX IF EXISTS idx_items_external_type;
DROP INDEX IF EXISTS idx_items_creator;
DROP INDEX IF EXISTS idx_items_name_search;
DROP INDEX IF EXISTS idx_items_type;
DROP INDEX IF EXISTS idx_items_folder;
DROP TABLE IF EXISTS items;
-- +goose StatementEnd
