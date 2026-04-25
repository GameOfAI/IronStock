-- +goose Up
-- +goose StatementBegin

-- Item field values. Each field references a field_definition (centralized
-- dictionary, ADR-0006 §2). is_secret comes from field_definition.
-- value_enc: encrypted blob; nullable when external_source supplies the value.

CREATE TABLE item_fields (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id               uuid         NOT NULL,
    field_definition_id   bigint       NOT NULL,
    -- nullable: external_source-backed item için bu field Vault'tan çekilir.
    -- ADR-0007 "Item Field Davranışı" tablosu.
    value_enc             bytea,
    value_nonce           bytea,
    position              int          NOT NULL DEFAULT 0,

    CONSTRAINT fk_item_fields_item
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_fields_def
        FOREIGN KEY (field_definition_id) REFERENCES field_definitions(id) ON DELETE RESTRICT,
    CONSTRAINT item_fields_uniq
        UNIQUE (item_id, field_definition_id),
    CONSTRAINT item_fields_value_consistency_chk
        CHECK (
            -- value_enc + value_nonce ya ikisi birden NULL (external) ya da ikisi birden dolu
            (value_enc IS NULL AND value_nonce IS NULL)
            OR (value_enc IS NOT NULL AND value_nonce IS NOT NULL AND octet_length(value_nonce) = 12)
        )
);

-- Field-definition'a göre arama (örn: "tüm hostname'leri çek" admin sorgu).
CREATE INDEX idx_item_fields_def ON item_fields (field_definition_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_item_fields_def;
DROP TABLE IF EXISTS item_fields;
-- +goose StatementEnd
