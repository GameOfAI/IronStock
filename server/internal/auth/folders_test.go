package auth

import (
	"context"
	"testing"
)

func TestFolderPermission_AllowsRead(t *testing.T) {
	cases := []struct {
		p    FolderPermission
		want bool
	}{
		{FolderPermNone, false},
		{FolderPermRead, true},
		{FolderPermWrite, true},
	}
	for _, tc := range cases {
		if got := tc.p.AllowsRead(); got != tc.want {
			t.Errorf("(%q).AllowsRead() = %v, want %v", tc.p, got, tc.want)
		}
	}
}

func TestFolderPermission_AllowsWrite(t *testing.T) {
	cases := []struct {
		p    FolderPermission
		want bool
	}{
		{FolderPermNone, false},
		{FolderPermRead, false},
		{FolderPermWrite, true},
	}
	for _, tc := range cases {
		if got := tc.p.AllowsWrite(); got != tc.want {
			t.Errorf("(%q).AllowsWrite() = %v, want %v", tc.p, got, tc.want)
		}
	}
}

func TestResolveFolderPermission_EmptyArgs(t *testing.T) {
	// Pass nil DBExec; the empty-arg guard fires before any DB call.
	if _, err := ResolveFolderPermission(context.TODO(), nil, "", "x"); err == nil {
		t.Error("expected error for empty userID")
	}
	if _, err := ResolveFolderPermission(context.TODO(), nil, "u", ""); err == nil {
		t.Error("expected error for empty folderID")
	}
}
