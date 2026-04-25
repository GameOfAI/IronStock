-- +goose Up
-- +goose StatementBegin

-- Folder-level ACL. Bkz. ADR-0006 §3, auth-flow.md "RBAC effective permission".
-- inherit_to_children: true ise alt klasörlere ve item'lara da geçer (ancestor walk).
-- revoked_at: soft revocation (history audit için).

CREATE TABLE folder_permissions (
    folder_id            uuid         NOT NULL,
    user_id              uuid         NOT NULL,
    permission           text         NOT NULL,
    inherit_to_children  boolean      NOT NULL DEFAULT true,
    granted_by           uuid,
    granted_at           timestamptz  NOT NULL DEFAULT now(),
    revoked_at           timestamptz,

    PRIMARY KEY (folder_id, user_id),

    CONSTRAINT fk_folder_perm_folder
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_folder_perm_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_folder_perm_granter
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT folder_perm_chk
        CHECK (permission IN ('read', 'write'))
);

-- "Bu user'ın yetkili olduğu folder'lar" sorgusu (RBAC middleware hot path).
CREATE INDEX idx_folder_perm_user_active
    ON folder_permissions (user_id)
    WHERE revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_folder_perm_user_active;
DROP TABLE IF EXISTS folder_permissions;
-- +goose StatementEnd
