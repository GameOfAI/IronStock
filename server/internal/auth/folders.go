package auth

// Folder permission resolution.
//
// 3-katmanlı RBAC effective permission (ADR-0006 §3, auth-flow.md "RBAC"):
//
//  1. Global rol — admin bypasses everything (returns Write). Caller checks
//     this BEFORE invoking the resolver.
//  2. Owner — folders.created_by == user_id implies Write.
//  3. Folder ACL — folder_permissions row on the folder OR any ancestor
//     where inherit_to_children=true. The strongest match wins (write > read).
//
// item_shares is layered on top by ResolveItemPermission (PR-9).
//
// Implementation: a single recursive CTE walks parent_id from the target
// folder up to the root, then LEFT JOINs folder_permissions for the user.
// Postgres collapses 'write' > 'read' > NULL via bool_or aggregates.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// FolderPermission is the result of an effective-permission check.
type FolderPermission string

const (
	// FolderPermNone — no access (no row matched, no inheritance).
	FolderPermNone FolderPermission = ""
	// FolderPermRead — list children, read folder name.
	FolderPermRead FolderPermission = "read"
	// FolderPermWrite — create/rename/delete + grant ACL.
	FolderPermWrite FolderPermission = "write"
)

// AllowsRead reports whether holding p satisfies a read-needing request.
// Write also allows read.
func (p FolderPermission) AllowsRead() bool {
	return p == FolderPermRead || p == FolderPermWrite
}

// AllowsWrite reports whether holding p satisfies a write-needing request.
func (p FolderPermission) AllowsWrite() bool {
	return p == FolderPermWrite
}

// ResolveFolderPermission walks the ancestor chain of folderID, looking for
// folder_permissions rows belonging to userID:
//
//   - the row on folderID itself counts unconditionally
//   - rows on any ancestor count only when inherit_to_children=true
//
// Owner short-circuit: if folders.created_by = userID, returns Write
// regardless of ACL. Admin short-circuit is the caller's job (claims.Roles).
//
// Returns FolderPermNone when the folder doesn't exist OR the user has no
// matching grant — caller decides how to surface (404 vs 403). We do NOT
// distinguish, to avoid a folder-existence oracle.
func ResolveFolderPermission(
	ctx context.Context, q DBExec, userID, folderID string,
) (FolderPermission, error) {
	if userID == "" || folderID == "" {
		return FolderPermNone, errors.New("auth: ResolveFolderPermission: empty userID/folderID")
	}

	// One round-trip query:
	//   1) confirm the folder exists + check ownership
	//   2) walk ancestors via CTE and aggregate ACL
	const sqlText = `
		WITH RECURSIVE ancestors AS (
		    SELECT id, parent_id, created_by, 0 AS depth
		    FROM folders WHERE id = $1::uuid
		    UNION ALL
		    SELECT f.id, f.parent_id, f.created_by, a.depth + 1
		    FROM folders f
		    JOIN ancestors a ON f.id = a.parent_id
		)
		SELECT
		    bool_or(a.depth = 0 AND a.created_by = $2::uuid) AS is_owner,
		    bool_or(
		        (a.depth = 0 OR fp.inherit_to_children)
		        AND fp.permission = 'write'
		    ) AS has_write,
		    bool_or(
		        (a.depth = 0 OR fp.inherit_to_children)
		        AND fp.permission IN ('read', 'write')
		    ) AS has_read,
		    count(*) > 0 AS folder_exists
		FROM ancestors a
		LEFT JOIN folder_permissions fp
		    ON fp.folder_id = a.id
		   AND fp.user_id = $2::uuid
		   AND fp.revoked_at IS NULL
	`
	var isOwner, hasWrite, hasRead, folderExists *bool
	err := q.QueryRow(ctx, sqlText, folderID, userID).Scan(
		&isOwner, &hasWrite, &hasRead, &folderExists,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FolderPermNone, nil
		}
		return FolderPermNone, err
	}
	if folderExists == nil || !*folderExists {
		return FolderPermNone, nil
	}
	if isOwner != nil && *isOwner {
		return FolderPermWrite, nil
	}
	if hasWrite != nil && *hasWrite {
		return FolderPermWrite, nil
	}
	if hasRead != nil && *hasRead {
		return FolderPermRead, nil
	}
	return FolderPermNone, nil
}
