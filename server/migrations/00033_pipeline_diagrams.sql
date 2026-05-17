-- +goose Up
-- Pipeline diagrams: named saved views of item relationship subgraphs (PR-F5d).

CREATE TABLE pipeline_diagrams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
    description TEXT,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id   UUID REFERENCES folders(id) ON DELETE SET NULL,
    layout_data JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_diagrams_created_by ON pipeline_diagrams (created_by);

CREATE TABLE pipeline_diagram_nodes (
    diagram_id   UUID NOT NULL REFERENCES pipeline_diagrams(id) ON DELETE CASCADE,
    item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position_x   DOUBLE PRECISION,
    position_y   DOUBLE PRECISION,
    custom_label TEXT,
    PRIMARY KEY (diagram_id, item_id)
);

-- +goose Down
DROP TABLE IF EXISTS pipeline_diagram_nodes;
DROP TABLE IF EXISTS pipeline_diagrams;
