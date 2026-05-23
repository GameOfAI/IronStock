-- PR-N3: Onay/Checkout Workflow
--
-- items.requires_approval: admin marks an item as requiring explicit approval
-- before any non-owner can view its secret fields.
--
-- access_requests: workflow table. Lifecycle:
--   pending → approved (expires_at set) → expired (by on-read check)
--   pending → denied
--   pending → cancelled (by requester)
--
-- Security note: The server enforces the approval gate in GET /items/{id}.
-- Fields are returned only if the requester has an active approved request
-- (status='approved' AND expires_at > NOW()). Admins and item owners bypass.

-- +goose Up

ALTER TABLE items ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE access_requests (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id                 UUID        NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
    requester_id            UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    status                  TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
    reason                  TEXT,
    deny_reason             TEXT,
    -- Requester's desired duration; approver may shorten via approve endpoint.
    access_duration_minutes INT         NOT NULL DEFAULT 60,
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at            TIMESTAMPTZ,
    approved_by             UUID        REFERENCES users(id),
    -- Set on approval: requested_at + access_duration_minutes (or approver override).
    expires_at              TIMESTAMPTZ
);

-- Only one pending request per (item, user) at a time.
CREATE UNIQUE INDEX idx_ar_pending_unique
    ON access_requests(item_id, requester_id)
    WHERE status = 'pending';

-- Fast pending list for admin dashboard (sorted by oldest first).
CREATE INDEX idx_ar_status_pending
    ON access_requests(requested_at)
    WHERE status = 'pending';

-- User's own request history.
CREATE INDEX idx_ar_requester
    ON access_requests(requester_id, requested_at DESC);

-- Item approval gate — check active approvals for a user+item quickly.
CREATE INDEX idx_ar_item_approved
    ON access_requests(item_id, requester_id, expires_at)
    WHERE status = 'approved';

-- +goose Down

DROP INDEX IF EXISTS idx_ar_item_approved;
DROP INDEX IF EXISTS idx_ar_requester;
DROP INDEX IF EXISTS idx_ar_status_pending;
DROP INDEX IF EXISTS idx_ar_pending_unique;
DROP TABLE IF EXISTS access_requests;
ALTER TABLE items DROP COLUMN IF EXISTS requires_approval;
