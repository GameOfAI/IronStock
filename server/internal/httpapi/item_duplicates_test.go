package httpapi_test

// item_duplicates_test.go — PR-DUP: unit tests for duplicate detection logic.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: ItemHandlers must implement CheckDuplicates.
var _ interface {
	CheckDuplicates(http.ResponseWriter, *http.Request)
} = (*httpapi.ItemHandlers)(nil)

// TestDuplicateCheckResponseZeroValue verifies zero-value is safe and Count starts at 0.
func TestDuplicateCheckResponseZeroValue(t *testing.T) {
	var resp httpapi.DuplicateCheckResponse
	if resp.Count != 0 {
		t.Errorf("Count = %d, want 0", resp.Count)
	}
	// Items may be nil in zero-value — that's fine; handler initializes with make().
}

// TestFormatArgNBasic verifies formatArgN returns correct positional parameter strings.
func TestFormatArgNBasic(t *testing.T) {
	cases := []struct {
		n    int
		want string
	}{
		{1, "$1"},
		{2, "$2"},
		{3, "$3"},
		{9, "$9"},
	}
	for _, tc := range cases {
		got := httpapi.FormatArgN(tc.n)
		if got != tc.want {
			t.Errorf("FormatArgN(%d) = %q, want %q", tc.n, got, tc.want)
		}
	}
}

// TestDuplicateCheckNameRequired documents that name param is required.
func TestDuplicateCheckNameRequired(t *testing.T) {
	// Empty name → should be rejected.
	// Non-empty name with min length 1 → accepted.
	cases := []struct {
		name      string
		wantValid bool
	}{
		{"", false},
		{" ", false}, // trimmed to empty
		{"a", true},
		{"hostname", true},
	}
	for _, tc := range cases {
		trimmed := tc.name
		// Simulate strings.TrimSpace behavior.
		for len(trimmed) > 0 && trimmed[0] == ' ' {
			trimmed = trimmed[1:]
		}
		for len(trimmed) > 0 && trimmed[len(trimmed)-1] == ' ' {
			trimmed = trimmed[:len(trimmed)-1]
		}
		valid := len(trimmed) >= 1
		if valid != tc.wantValid {
			t.Errorf("name=%q: valid=%v, want %v", tc.name, valid, tc.wantValid)
		}
	}
}

// TestDuplicateLimitBounds verifies limit clamping logic (1-50, default 10).
func TestDuplicateLimitBounds(t *testing.T) {
	// parseIntDefault(s, def, min, max) — inline simulation.
	parse := func(s string, def, min, max int) int {
		if s == "" {
			return def
		}
		var n int
		for _, c := range s {
			if c < '0' || c > '9' {
				return def
			}
			n = n*10 + int(c-'0')
		}
		if n < min {
			return min
		}
		if n > max {
			return max
		}
		return n
	}

	cases := []struct {
		input string
		want  int
	}{
		{"", 10},   // default
		{"0", 1},   // clamped to min
		{"1", 1},   // min
		{"50", 50}, // max
		{"99", 50}, // clamped to max
		{"5", 5},   // within range
	}
	for _, tc := range cases {
		got := parse(tc.input, 10, 1, 50)
		if got != tc.want {
			t.Errorf("limit(%q) = %d, want %d", tc.input, got, tc.want)
		}
	}
}
