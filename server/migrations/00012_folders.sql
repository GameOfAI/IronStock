-- +goose Up
-- +goose StatementBegin

-- Folder tree (KeePassXC-style hierarchy).
-- name encrypted with server-side envelope (ADR-0004 §6).
-- name_search: HMAC-SHA256 hash, truncate-to-128-bit, searchable encryption.

CREATE TABLE folders (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       uuid,        -- NULL = root folder
    name_enc        bytea        NOT NULL,
    name_nonce      bytea        NOT NULL,
    name_search     bytea        NOT NULL,
    master_key_id   smallint     NOT NULL,
    position        int          NOT NULL DEFAULT 0,
    created_by      uuid         NOT NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_folders_parent
        FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_folders_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_folders_master_key
        FOREIGN KEY (master_key_id) REFERENCES master_keys(id) ON DELETE RESTRICT,
    CONSTRAINT folders_nonce_len_chk
        CHECK (octet_length(name_nonce) = 12),
    CONSTRAINT folders_search_len_chk
        CHECK (octet_length(name_search) = 16),
    CONSTRAINT folders_no_self_parent_chk
        CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Tree traversal: find children of a folder.
CREATE INDEX idx_folders_parent ON folders (parent_id);

-- Search by hashed name (deterministic encryption arama).
CREATE INDEX idx_folders_name_search ON folders (name_search);

CREATE TRIGGER trg_folders_updated_at
    BEFORE UPDATE ON folders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS trg_folders_updated_at ON folders;
DROP INDEX IF EXISTS idx_folders_name_search;
DROP INDEX IF EXISTS idx_folders_parent;
DROP TABLE IF EXISTS folders;
-- +goose StatementEnd
