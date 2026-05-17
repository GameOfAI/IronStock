-- +goose Up
-- DevOps lifecycle stages: sabit katalog + item-stage many-to-many atama.

CREATE TABLE lifecycle_stages (
    id          SMALLSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 2 AND 32),
    label       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 64),
    sort_order  SMALLINT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6366f1' CHECK (char_length(color) BETWEEN 4 AND 9)
);

INSERT INTO lifecycle_stages (key, label, sort_order, color) VALUES
    ('plan',    'Planlama',   1, '#8b5cf6'),
    ('code',    'Kaynak Kod', 2, '#3b82f6'),
    ('build',   'Build',      3, '#06b6d4'),
    ('test',    'Test',       4, '#10b981'),
    ('release', 'Release',    5, '#f59e0b'),
    ('deploy',  'Deploy',     6, '#ef4444'),
    ('operate', 'İşletim',    7, '#ec4899'),
    ('monitor', 'İzleme',     8, '#6366f1');

CREATE TABLE item_lifecycle_stages (
    item_id            UUID     NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    lifecycle_stage_id SMALLINT NOT NULL REFERENCES lifecycle_stages(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, lifecycle_stage_id)
);

CREATE INDEX idx_item_lifecycle_stage ON item_lifecycle_stages (lifecycle_stage_id);

-- +goose Down
DROP TABLE IF EXISTS item_lifecycle_stages;
DROP TABLE IF EXISTS lifecycle_stages;
