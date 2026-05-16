-- +goose Up
-- PR-N5: One-time / view-limited share links.
--
-- A creator wraps the item DEK with a randomly generated link_key, stores the
-- wrapped blob here, and embeds the link_key in the URL fragment (never sent
-- to the server). Anyone with the URL can decrypt the item fields for a
-- limited number of views within the TTL.
--
-- token_hash: SHA-256(random_token) — never stores the raw token.
-- dek_wrapped: item_dek AES-256-GCM encrypted with link_key (versioned blob).
-- view_limit / view_count: server atomically increments on each access and
-- refuses when view_count >= view_limit.

CREATE TABLE item_share_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    dek_wrapped BYTEA NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    view_limit  SMALLINT NOT NULL DEFAULT 1 CHECK (view_limit BETWEEN 1 AND 10),
    view_count  SMALLINT NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_links_item ON item_share_links (item_id);

-- +goose Down
DROP TABLE IF EXISTS item_share_links;
