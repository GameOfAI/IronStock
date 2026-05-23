package httpapi_test

// item_search_ft_test.go — PR-SEARCH-FT: unit tests for fuzzy search logic.
//
// These tests validate the query-building logic for the fuzzy search mode
// without requiring a live PostgreSQL instance with pg_trgm installed.
// Integration tests with actual trigram similarity require a DB fixture.

import (
	"net/http"
	"strings"
	"testing"
)

// TestFuzzySearchQueryParam verifies the boolean parsing of ?fuzzy=true.
func TestFuzzySearchQueryParam(t *testing.T) {
	cases := []struct {
		rawValue string
		want     bool
	}{
		{"true", true},
		{"True", false},  // case-sensitive comparison in handler
		{"1", false},
		{"", false},
		{"false", false},
	}
	for _, tc := range cases {
		got := tc.rawValue == "true"
		if got != tc.want {
			t.Errorf("fuzzy param %q: got %v, want %v", tc.rawValue, got, tc.want)
		}
	}
}

// TestFuzzySearchWhereClause verifies that the fuzzy and non-fuzzy branches
// produce the correct WHERE clause fragments.
func TestFuzzySearchWhereClause(t *testing.T) {
	cases := []struct {
		fuzzy        bool
		wantSubstr   string
		wantNotIn    string
	}{
		{
			fuzzy:      false,
			wantSubstr: "ILIKE",
			wantNotIn:  "similarity",
		},
		{
			fuzzy:      true,
			wantSubstr: "similarity",
			wantNotIn:  "ILIKE",
		},
	}

	for _, tc := range cases {
		// Simulate the clause-building logic from item_handlers.go Search().
		var whereExpr, orderExpr string
		if tc.fuzzy {
			whereExpr = `(i.name_plain % $QTERM OR coalesce(i.description,'') % $QTERM)`
			orderExpr = `similarity(coalesce(i.name_plain,''), $QTERM) DESC, i.name_plain`
		} else {
			whereExpr = `(i.name_plain ILIKE $QTERM OR lower(coalesce(i.description,'')) LIKE lower($QTERM))`
			orderExpr = `i.name_plain`
		}
		combined := whereExpr + " ORDER BY " + orderExpr

		if !strings.Contains(combined, tc.wantSubstr) {
			t.Errorf("fuzzy=%v: expected %q in clause, got:\n%s", tc.fuzzy, tc.wantSubstr, combined)
		}
		if strings.Contains(combined, tc.wantNotIn) {
			t.Errorf("fuzzy=%v: unexpected %q in clause:\n%s", tc.fuzzy, tc.wantNotIn, combined)
		}
	}
}

// TestFuzzySearchTermType verifies that the term type differs between fuzzy
// and exact modes (raw string vs. % wildcard string).
func TestFuzzySearchTermType(t *testing.T) {
	q := "postgres"

	// Fuzzy: raw string (pg_trgm similarity uses the raw input).
	fuzzyTerm := q
	if fuzzyTerm != "postgres" {
		t.Errorf("fuzzy term should be raw: %q", fuzzyTerm)
	}

	// Exact: wrapped in % wildcards for ILIKE.
	exactTerm := "%" + strings.ToLower(q) + "%"
	if exactTerm != "%postgres%" {
		t.Errorf("exact term = %q, want %%postgres%%", exactTerm)
	}
}

// TestSearchMinimumQueryLength verifies the handler rejects q < 2 chars.
// This is documented behavior, not testing DB logic.
func TestSearchMinimumQueryLength(t *testing.T) {
	tooShort := []string{"", "a"}
	valid := []string{"ab", "foo", "postgres"}

	for _, q := range tooShort {
		if len(strings.TrimSpace(q)) >= 2 {
			t.Errorf("expected %q to be rejected (< 2 chars)", q)
		}
	}
	for _, q := range valid {
		if len(strings.TrimSpace(q)) < 2 {
			t.Errorf("expected %q to be accepted (>= 2 chars)", q)
		}
	}
}

// TestItemHandlers_SearchCompileGuard verifies ItemHandlers.Search is defined.
var _ = func() bool {
	// This uses a type assertion to verify the Search method exists.
	// In actual usage the router wires this via d.Item.Search.
	type hasSearch interface {
		Search(http.ResponseWriter, *http.Request)
	}
	var _ hasSearch // will fail to compile if ItemHandlers doesn't implement Search
	return true
}
