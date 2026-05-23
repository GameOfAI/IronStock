package httpapi_test

// scim_handlers_test.go — PR-SCIM: compile + unit guards for SCIM helpers.

import (
	"testing"

	"envanter.app/server/internal/httpapi"
)

// TestSCIMHandlers_NotNil is a compile guard: the SCIMHandlers type must exist
// and be constructable with zero-value fields.
func TestSCIMHandlers_NotNil(t *testing.T) {
	h := &httpapi.SCIMHandlers{}
	if h == nil {
		t.Fatal("SCIMHandlers is nil")
	}
}

// TestSCIMParseFilter_Empty verifies an empty filter returns "true" (no WHERE clause).
func TestSCIMParseFilter_Empty(t *testing.T) {
	sql, args := httpapi.SCIMParseFilterExported("")
	if sql != "true" {
		t.Errorf("expected 'true', got %q", sql)
	}
	if len(args) != 0 {
		t.Errorf("expected no args, got %d", len(args))
	}
}

// TestSCIMParseFilter_UserName verifies userName eq filter builds correct SQL.
func TestSCIMParseFilter_UserName(t *testing.T) {
	sql, args := httpapi.SCIMParseFilterExported(`userName eq "alice"`)
	if sql == "true" {
		t.Error("expected filter SQL, got 'true'")
	}
	if len(args) == 0 {
		t.Error("expected filter args, got none")
	}
}

// TestSCIMParseFilter_ExternalID verifies externalId eq filter.
func TestSCIMParseFilter_ExternalID(t *testing.T) {
	sql, args := httpapi.SCIMParseFilterExported(`externalId eq "azure-uuid-123"`)
	if sql == "true" {
		t.Error("expected filter SQL, got 'true'")
	}
	if len(args) == 0 {
		t.Error("expected filter args, got none")
	}
}

// TestSCIMExtractValueEq verifies path parsing for "members[value eq \"uuid\"]".
func TestSCIMExtractValueEq(t *testing.T) {
	cases := []struct {
		path     string
		expected string
	}{
		{`members[value eq "abc-123"]`, "abc-123"},
		{`members[value eq 'xyz']`, "xyz"},
		{`members`, ""},
	}
	for _, c := range cases {
		got := httpapi.SCIMExtractValueEqExported(c.path)
		if got != c.expected {
			t.Errorf("path=%q: expected %q, got %q", c.path, c.expected, got)
		}
	}
}
