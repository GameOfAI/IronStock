package httpapi

import "testing"

func TestIsCleanVaultPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"simple path", "my/secret", true},
		{"single segment", "password", true},
		{"nested path", "team/prod/db-creds", true},

		{"dot-dot traversal", "../etc/passwd", false},
		{"mid-path traversal", "secret/../../admin", false},
		{"double slash", "secret//hidden", false},
		{"leading slash", "/absolute/path", false},
		{"backslash", "secret\\path", false},
		{"null byte", "secret\x00path", false},
		{"control char", "secret\x1fpath", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isCleanVaultPath(tt.path)
			if got != tt.want {
				t.Errorf("isCleanVaultPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}
