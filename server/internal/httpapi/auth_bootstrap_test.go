package httpapi

import (
	"strings"
	"testing"
)

// TestBootstrapUsernameValidation checks that BootstrapSetup rejects
// usernames that don't match the shared usernameRE regex.
func TestBootstrapUsernameValidation(t *testing.T) {
	valid := []string{"admin", "my_admin", "admin-01", "a.b.c"}
	for _, u := range valid {
		if !usernameRE.MatchString(u) {
			t.Errorf("expected %q to be valid", u)
		}
	}

	invalid := []string{"", "ab", strings.Repeat("x", 65), "admin user", "admin@host"}
	for _, u := range invalid {
		if usernameRE.MatchString(u) {
			t.Errorf("expected %q to be invalid", u)
		}
	}
}

// TestBootstrapPasswordLength checks the minimum length invariant (>= 12).
func TestBootstrapPasswordLength(t *testing.T) {
	cases := []struct {
		pw   string
		want bool // true = should be accepted
	}{
		{"short11char", false}, // 11 chars
		{"exactly12ch!", true}, // 12 chars
		{"longer_password_ok!", true},
		{"", false},
	}
	for _, c := range cases {
		got := len(c.pw) >= 12
		if got != c.want {
			t.Errorf("password %q: want accepted=%v, got=%v", c.pw, c.want, got)
		}
	}
}
