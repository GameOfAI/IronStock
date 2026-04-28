-- +goose Up
-- +goose StatementBegin
CREATE TABLE item_attachments (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id          UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    file_name        TEXT        NOT NULL,
    content_type     TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes       BIGINT      NOT NULL DEFAULT 0,
    storage_key      TEXT        NOT NULL,
    is_encrypted     BOOLEAN     NOT NULL DEFAULT true,
    file_nonce       TEXT,
    upload_confirmed BOOLEAN     NOT NULL DEFAULT false,
    created_by       UUID        NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX item_attachments_item_id_idx ON item_attachments (item_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS item_attachments;
-- +goose StatementEnd
