-- +goose Up
-- PR-DP01: item_annotations — Backstage metadata.annotations karşılığı.
-- Her item'a freeform key-value annotation eklenebilir.
-- Örnekler: grafana/dashboard-url, github.com/project-slug, oncall/team
CREATE TABLE item_annotations (
    item_id    UUID  NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    key        TEXT  NOT NULL CHECK (length(key)   BETWEEN 1 AND 256),
    value      TEXT  NOT NULL CHECK (length(value) BETWEEN 0 AND 4096),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, key)
);

CREATE INDEX idx_item_annotations_item_id ON item_annotations (item_id);

-- +goose Down
DROP INDEX IF EXISTS idx_item_annotations_item_id;
DROP TABLE IF EXISTS item_annotations;
