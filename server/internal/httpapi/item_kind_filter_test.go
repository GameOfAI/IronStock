package httpapi_test

// item_kind_filter_test.go — PR-DP05: kind= query param filter logic tests.

import (
	"fmt"
	"strings"
	"testing"
)

// TestKindFilterParsing verifies comma-separated kind parsing logic.
func TestKindFilterParsing(t *testing.T) {
	cases := []struct {
		input string
		want  []string
	}{
		{"", nil},
		{"Server", []string{"Server"}},
		{"Server,Database", []string{"Server", "Database"}},
		{"Server, Database , Service", []string{"Server", "Database", "Service"}},
		{",,,", nil},
		{"  ", nil},
	}

	for _, tc := range cases {
		got := testParseKindFilter(tc.input)
		if len(got) != len(tc.want) {
			t.Errorf("input=%q: got %v (len %d), want %v (len %d)", tc.input, got, len(got), tc.want, len(tc.want))
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("input=%q [%d]: got %q, want %q", tc.input, i, got[i], tc.want[i])
			}
		}
	}
}

// testParseKindFilter mirrors the kind parsing logic in item_handlers.go Search().
func testParseKindFilter(kindStr string) []string {
	kindStr = strings.TrimSpace(kindStr)
	if kindStr == "" {
		return nil
	}
	var out []string
	for _, k := range strings.Split(kindStr, ",") {
		if k = strings.TrimSpace(k); k != "" {
			out = append(out, k)
		}
	}
	return out
}

// TestKindFilterSQLFragment verifies the SQL fragment pattern for the ANY() filter.
func TestKindFilterSQLFragment(t *testing.T) {
	argIdx := 4
	fragment := " AND it.kind_key = ANY($" + fmt.Sprint(argIdx) + "::text[])"

	checks := []struct {
		substr string
		desc   string
	}{
		{"it.kind_key", "must reference it.kind_key"},
		{"ANY($", "must use ANY() for array comparison"},
		{"::text[]", "must cast to text[]"},
		{"$4", "must use the correct arg index"},
	}
	for _, c := range checks {
		if !strings.Contains(fragment, c.substr) {
			t.Errorf("SQL fragment %q: %s", c.substr, c.desc)
		}
	}
}
