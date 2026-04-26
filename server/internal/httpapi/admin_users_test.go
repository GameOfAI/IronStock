package httpapi

import "testing"

func TestValidRoleName(t *testing.T) {
	good := []string{RoleAdmin, RoleWrite, RoleRead}
	for _, r := range good {
		if !validRoleName(r) {
			t.Errorf("validRoleName(%q) = false", r)
		}
	}
	bad := []string{"", "ADMIN", "superuser", "Admin", " write"}
	for _, r := range bad {
		if validRoleName(r) {
			t.Errorf("validRoleName(%q) = true (expected false)", r)
		}
	}
}

func TestParseIntDefault_Defaults(t *testing.T) {
	cases := []struct {
		in          string
		def, lo, hi int
		want        int
	}{
		{"", 50, 1, 200, 50},
		{"abc", 50, 1, 200, 50},
		{"0", 50, 1, 200, 1},       // clamped to lo
		{"-10", 50, 1, 200, 1},     // clamped to lo
		{"99999", 50, 1, 200, 200}, // clamped to hi
		{"75", 50, 1, 200, 75},
		{"1", 50, 1, 200, 1},
		{"200", 50, 1, 200, 200},
	}
	for _, tc := range cases {
		if got := parseIntDefault(tc.in, tc.def, tc.lo, tc.hi); got != tc.want {
			t.Errorf("parseIntDefault(%q, def=%d, [%d,%d]) = %d, want %d",
				tc.in, tc.def, tc.lo, tc.hi, got, tc.want)
		}
	}
}
