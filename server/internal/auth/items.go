package auth

// Item permission resolution.
//
// Effective permission on an item is the strongest of three signals
// (ADR-0006 §3, ADR-0006 §4):
//
//  1. Owner — items.created_by = user_id implies Write.
//  2. Item share — item_shares row (revoked_at IS NULL) for this user
//     gives Read or Write directly.
//  3. Folder permission — ResolveFolderPermission walks the parent folder
//     chain (inherit_to_children=true on ancestors).
//
// We DO NOT short-circuit on item-share match; folder permissions can
// still grant Write where the share gave only Read. Maximum wins.
//
// Caller checks admin role (claims.Roles) BEFORE invoking this resolver.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ItemPermission mirrors FolderPermission but kept separate so item-side
// callers don't have to import folder semantics. Same semantics:
// Write satisfies Read, None satisfies neither.
type ItemPermission string

const (
	// ItemPermNone — no access (item not found OR no grant matched).
	ItemPermNone ItemPermission = ""
	// ItemPermRead — view item + decrypt fields (subject to E2E key wrap).
	ItemPermRead ItemPermission = "read"
	// ItemPermWrite — edit, delete, share.
	ItemPermWrite ItemPermission = "write"
)

// AllowsRead reports whether p satisfies a read-needing request.
func (p ItemPermission) AllowsRead() bool {
	return p == ItemPermRead || p == ItemPermWrite
}

// AllowsWrite reports whether p satisfies a write-needing request.
func (p ItemPermission) AllowsWrite() bool {
	return p == ItemPermWrite
}

// ResolveItemPermission returns the caller's effective permission on
// itemID. Four sub-queries — owner, direct user share, group share, folder ACL.
// Simple indexed PK lookups are faster than one big CTE for typical usage.
//
// Returns ItemPermNone if the item doesn't exist OR the user has no
// matching grant. Caller decides surface (404 vs 403); we don't leak
// existence.
func ResolveItemPermission(
	ctx context.Context, q DBExec, userID, itemID string,
) (ItemPermission, error) {
	if userID == "" || itemID == "" {
		return ItemPermNone, errors.New("auth: ResolveItemPermission: empty userID/itemID")
	}

	// 1. Item lookup — folder + ownership.
	var folderID, createdBy string
	err := q.QueryRow(ctx, `
		SELECT folder_id::text, created_by::text
		FROM items
		WHERE id = $1::uuid
		LIMIT 1
	`, itemID).Scan(&folderID, &createdBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ItemPermNone, nil
		}
		return ItemPermNone, err
	}

	// Owner short-circuit: nothing beats Write.
	if createdBy == userID {
		return ItemPermWrite, nil
	}

	// 2. Direct item share (active grant, within time window).
	var sharePerm *string
	err = q.QueryRow(ctx, `
		SELECT permission
		FROM item_shares
		WHERE item_id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL
		  AND (valid_from IS NULL OR valid_from <= NOW())
		  AND (valid_until IS NULL OR valid_until > NOW())
		LIMIT 1
	`, itemID, userID).Scan(&sharePerm)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ItemPermNone, err
	}
	fromShare := ItemPermNone
	if sharePerm != nil {
		if *sharePerm == "write" {
			fromShare = ItemPermWrite
		} else {
			fromShare = ItemPermRead
		}
	}

	// Early Write hit — nothing can strengthen further.
	if fromShare == ItemPermWrite {
		return ItemPermWrite, nil
	}

	// 3. Group share — check if user is a member of any group that has an
	// active, in-window group share for this item.
	var groupSharePerm *string
	err = q.QueryRow(ctx, `
		SELECT igs.permission
		FROM item_group_shares igs
		JOIN group_members gm ON gm.group_id = igs.group_id
		WHERE igs.item_id = $1::uuid
		  AND gm.user_id  = $2::uuid
		  AND igs.revoked_at IS NULL
		  AND (igs.valid_from  IS NULL OR igs.valid_from  <= NOW())
		  AND (igs.valid_until IS NULL OR igs.valid_until >  NOW())
		ORDER BY igs.permission DESC  -- 'write' > 'read'
		LIMIT 1
	`, itemID, userID).Scan(&groupSharePerm)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ItemPermNone, err
	}
	fromGroupShare := ItemPermNone
	if groupSharePerm != nil {
		if *groupSharePerm == "write" {
			fromGroupShare = ItemPermWrite
		} else {
			fromGroupShare = ItemPermRead
		}
	}

	// Early Write hit again.
	if fromGroupShare == ItemPermWrite {
		return ItemPermWrite, nil
	}

	// 4. Folder ACL via shared resolver.
	folderPerm, err := ResolveFolderPermission(ctx, q, userID, folderID)
	if err != nil {
		return ItemPermNone, err
	}
	fromFolder := folderPermToItemPerm(folderPerm)

	return maxItemPerm(maxItemPerm(fromShare, fromGroupShare), fromFolder), nil
}

func folderPermToItemPerm(fp FolderPermission) ItemPermission {
	switch fp {
	case FolderPermWrite:
		return ItemPermWrite
	case FolderPermRead:
		return ItemPermRead
	}
	return ItemPermNone
}

// maxItemPerm returns the stronger of two ItemPermission values.
// Write > Read > None (string ordering happens to work but be explicit).
func maxItemPerm(a, b ItemPermission) ItemPermission {
	if a == ItemPermWrite || b == ItemPermWrite {
		return ItemPermWrite
	}
	if a == ItemPermRead || b == ItemPermRead {
		return ItemPermRead
	}
	return ItemPermNone
}
