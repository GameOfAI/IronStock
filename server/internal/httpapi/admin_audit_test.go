package httpapi

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// asValues wraps a query string into url.Values for buildAuditFilter.
func asValues(qs string) map[string][]string {
	v, _ := url.ParseQuery(qs)
	return v
}

func TestBuildAuditFilter_Empty(t *testing.T) {
	f, err := buildAuditFilter(asValues(""))
	if err != nil {
		t.Fatal(err)
	}
	if f.action != "" || f.actorUserID != "" || f.from != nil || f.to != nil {
		t.Errorf("empty filter populated: %+v", f)
	}
}

func TestBuildAuditFilter_AllFields(t *testing.T) {
	qs := "action=auth.login&actor_user_id=u1&resource_type=item&resource_id=i1" +
		"&from=2026-04-01T00:00:00Z&to=2026-04-30T00:00:00Z"
	f, err := buildAuditFilter(asValues(qs))
	if err != nil {
		t.Fatal(err)
	}
	if f.action != "auth.login" {
		t.Errorf("action = %q", f.action)
	}
	if f.actorUserID != "u1" {
		t.Errorf("actor = %q", f.actorUserID)
	}
	if f.resourceType != "item" {
		t.Errorf("rtype = %q", f.resourceType)
	}
	if f.resourceID != "i1" {
		t.Errorf("rid = %q", f.resourceID)
	}
	if f.from == nil || f.to == nil {
		t.Fatal("from/to should be set")
	}
}

func TestBuildAuditFilter_BadResourceType(t *testing.T) {
	if _, err := buildAuditFilter(asValues("resource_type=hack")); err == nil {
		t.Error("invalid resource_type accepted")
	}
}

func TestBuildAuditFilter_BadFromDate(t *testing.T) {
	if _, err := buildAuditFilter(asValues("from=not-a-date")); err == nil {
		t.Error("invalid from accepted")
	}
}

func TestBuildAuditFilter_ToBeforeFrom(t *testing.T) {
	qs := "from=2026-05-01T00:00:00Z&to=2026-04-01T00:00:00Z"
	if _, err := buildAuditFilter(asValues(qs)); err == nil {
		t.Error("to-before-from accepted")
	}
}

func TestValidResourceType(t *testing.T) {
	good := []string{"user", "session", "role", "folder", "item", "item_share", "master_key", "system"}
	for _, rt := range good {
		if !validResourceType(rt) {
			t.Errorf("validResourceType(%q) = false", rt)
		}
	}
	bad := []string{"", "User", "items", "hack"}
	for _, rt := range bad {
		if validResourceType(rt) {
			t.Errorf("validResourceType(%q) = true (expected false)", rt)
		}
	}
}

func TestAuditFilter_WhereClause_Empty(t *testing.T) {
	f := auditFilter{}
	where, args := f.whereClause()
	if where != "" {
		t.Errorf("empty filter where = %q, want empty", where)
	}
	if len(args) != 0 {
		t.Errorf("empty filter args = %v, want []", args)
	}
}

func TestAuditFilter_WhereClause_AllConditions(t *testing.T) {
	from := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	f := auditFilter{
		action:       "auth.login",
		actorUserID:  "u1",
		resourceType: "item",
		resourceID:   "i1",
		from:         &from,
		to:           &to,
	}
	where, args := f.whereClause()
	if !strings.HasPrefix(where, "WHERE ") {
		t.Errorf("where missing prefix: %q", where)
	}
	if len(args) != 6 {
		t.Errorf("args len = %d, want 6", len(args))
	}
	for i, want := range []string{"$1", "$2", "$3", "$4", "$5", "$6"} {
		if !strings.Contains(where, want) {
			t.Errorf("where missing placeholder %s (i=%d): %s", want, i, where)
		}
	}
}

func TestAuditFilter_BuildPageSQL_PlaceholdersAdvance(t *testing.T) {
	f := auditFilter{action: "auth.login"}
	sql, args := f.buildPageSQL(50, 0)
	if !strings.Contains(sql, "LIMIT $2 OFFSET $3") {
		t.Errorf("expected LIMIT $2 OFFSET $3, got SQL:\n%s", sql)
	}
	if len(args) != 3 {
		t.Errorf("args len = %d, want 3", len(args))
	}
}

func TestEmptyToNil(t *testing.T) {
	if emptyToNil("") != nil {
		t.Error("empty -> non-nil")
	}
	got := emptyToNil("x")
	if got == nil || *got != "x" {
		t.Error("non-empty roundtrip failed")
	}
}
