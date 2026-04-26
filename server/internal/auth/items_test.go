package auth

import (
	"context"
	"testing"
)

func TestItemPermission_AllowsRead(t *testing.T) {
	cases := []struct {
		p    ItemPermission
		want bool
	}{
		{ItemPermNone, false},
		{ItemPermRead, true},
		{ItemPermWrite, true},
	}
	for _, tc := range cases {
		if got := tc.p.AllowsRead(); got != tc.want {
			t.Errorf("(%q).AllowsRead() = %v, want %v", tc.p, got, tc.want)
		}
	}
}

func TestItemPermission_AllowsWrite(t *testing.T) {
	cases := []struct {
		p    ItemPermission
		want bool
	}{
		{ItemPermNone, false},
		{ItemPermRead, false},
		{ItemPermWrite, true},
	}
	for _, tc := range cases {
		if got := tc.p.AllowsWrite(); got != tc.want {
			t.Errorf("(%q).AllowsWrite() = %v, want %v", tc.p, got, tc.want)
		}
	}
}

func TestMaxItemPerm(t *testing.T) {
	// Write dominates everything.
	if got := maxItemPerm(ItemPermWrite, ItemPermNone); got != ItemPermWrite {
		t.Errorf("max(Write, None) = %q, want Write", got)
	}
	if got := maxItemPerm(ItemPermNone, ItemPermWrite); got != ItemPermWrite {
		t.Errorf("max(None, Write) = %q, want Write", got)
	}
	// Read beats None.
	if got := maxItemPerm(ItemPermRead, ItemPermNone); got != ItemPermRead {
		t.Errorf("max(Read, None) = %q, want Read", got)
	}
	// Write beats Read.
	if got := maxItemPerm(ItemPermWrite, ItemPermRead); got != ItemPermWrite {
		t.Errorf("max(Write, Read) = %q, want Write", got)
	}
	// None + None = None.
	if got := maxItemPerm(ItemPermNone, ItemPermNone); got != ItemPermNone {
		t.Errorf("max(None, None) = %q, want None", got)
	}
}

func TestFolderPermToItemPerm(t *testing.T) {
	cases := []struct {
		f    FolderPermission
		want ItemPermission
	}{
		{FolderPermWrite, ItemPermWrite},
		{FolderPermRead, ItemPermRead},
		{FolderPermNone, ItemPermNone},
	}
	for _, tc := range cases {
		if got := folderPermToItemPerm(tc.f); got != tc.want {
			t.Errorf("folderPermToItemPerm(%q) = %q, want %q", tc.f, got, tc.want)
		}
	}
}

func TestResolveItemPermission_EmptyArgs(t *testing.T) {
	if _, err := ResolveItemPermission(context.TODO(), nil, "", "x"); err == nil {
		t.Error("expected error for empty userID")
	}
	if _, err := ResolveItemPermission(context.TODO(), nil, "u", ""); err == nil {
		t.Error("expected error for empty itemID")
	}
}
