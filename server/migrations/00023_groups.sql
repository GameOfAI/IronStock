-- +goose Up
-- +goose StatementBegin

-- Groups: named sets of users for bulk folder permission grants.
-- ADR pattern: soft-delete via revoked_at on folder_group_permissions,
-- hard-delete on groups (cascades to memberships + permissions).

CREATE TABLE groups (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text         NOT NULL CHECK (char_length(name) BETWEEN 2 AND 128),
    description text,
    created_by  uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT groups_name_uniq UNIQUE (name)
);

CREATE TABLE group_members (
    group_id    uuid         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by    uuid         REFERENCES users(id) ON DELETE SET NULL,
    added_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members (user_id);

CREATE TABLE folder_group_permissions (
    folder_id           uuid         NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    group_id            uuid         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    permission          text         NOT NULL CHECK (permission IN ('read','write')),
    inherit_to_children boolean      NOT NULL DEFAULT true,
    granted_by          uuid         REFERENCES users(id) ON DELETE SET NULL,
    granted_at          timestamptz  NOT NULL DEFAULT now(),
    revoked_at          timestamptz,
    PRIMARY KEY (folder_id, group_id)
);

CREATE INDEX idx_fgp_group_active ON folder_group_permissions (group_id)
    WHERE revoked_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS folder_group_permissions;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
-- +goose StatementEnd
