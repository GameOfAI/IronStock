-- +goose Up
-- +goose StatementBegin

-- Tags + user favorites (PR-N7).
--
-- tags: personal labels owned by the creator. Shared items in different users'
--   view can each have independent tags. name is unique per creator so the
--   same label string can be re-used across accounts.
-- item_tags: many-to-many join; any user with Read access can tag an item.
-- user_favorites: per-user bookmarks; pinned items appear at top of inventory.

CREATE TABLE tags (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text         NOT NULL
                             CHECK (char_length(name) BETWEEN 1 AND 64),
    color       text         CHECK (color ~ '^#[0-9a-fA-F]{6}$'),  -- optional hex color
    created_by  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (name, created_by)
);

CREATE INDEX idx_tags_owner ON tags (created_by);

CREATE TABLE item_tags (
    item_id     uuid  NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id      uuid  NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    tagged_by   uuid  REFERENCES users(id) ON DELETE SET NULL,
    tagged_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX idx_item_tags_tag ON item_tags (tag_id);

CREATE TABLE user_favorites (
    user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id    uuid         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    pinned_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites (user_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_user_favorites_user;
DROP TABLE IF EXISTS user_favorites;
DROP INDEX IF EXISTS idx_item_tags_tag;
DROP TABLE IF EXISTS item_tags;
DROP INDEX IF EXISTS idx_tags_owner;
DROP TABLE IF EXISTS tags;

-- +goose StatementEnd
