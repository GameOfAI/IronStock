package cmd

// root_test.go — compile guard + command tree tests for the ironstock CLI.

import (
	"testing"
)

// TestCommandTree ensures all expected sub-commands are registered.
func TestCommandTree(t *testing.T) {
	t.Parallel()
	expected := []string{
		"login", "logout", "get", "search", "list",
		"create", "update", "export", "relationship", "version",
	}
	registered := make(map[string]bool)
	for _, c := range rootCmd.Commands() {
		registered[c.Name()] = true
	}
	for _, name := range expected {
		if !registered[name] {
			t.Errorf("command %q not registered in root command", name)
		}
	}
}

// TestIsUUID validates the UUID helper.
func TestIsUUID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		s    string
		want bool
	}{
		{"550e8400-e29b-41d4-a716-446655440000", true},
		{"not-a-uuid", false},
		{"", false},
		{"550e8400-e29b-41d4-a716-44665544", false}, // too short
		{"550e8400e29b41d4a716446655440000", false},  // no dashes
	}
	for _, tt := range tests {
		if got := isUUID(tt.s); got != tt.want {
			t.Errorf("isUUID(%q) = %v, want %v", tt.s, got, tt.want)
		}
	}
}

// TestGetFindFieldValue_Empty verifies that nil fields return empty string.
func TestGetFindFieldValue_Empty(t *testing.T) {
	t.Parallel()
	it := &item{Fields: nil}
	if got := findFieldValue(it, "password"); got != "" {
		t.Errorf("expected empty string for nil fields, got %q", got)
	}
}

// TestGetFindFieldValue_PlainField verifies that a non-secret field returns its value.
func TestGetFindFieldValue_PlainField(t *testing.T) {
	t.Parallel()
	val := "10.0.0.1"
	it := &item{Fields: []itemField{
		{FieldDefKey: "hostname", Label: "Hostname", IsSecret: false, ValuePlain: &val},
	}}
	if got := findFieldValue(it, "hostname"); got != val {
		t.Errorf("expected %q, got %q", val, got)
	}
}

// TestGetFindFieldValue_SecretField verifies that a secret field returns empty.
func TestGetFindFieldValue_SecretField(t *testing.T) {
	t.Parallel()
	it := &item{Fields: []itemField{
		{FieldDefKey: "password", Label: "Password", IsSecret: true, ValuePlain: nil},
	}}
	if got := findFieldValue(it, "password"); got != "" {
		t.Errorf("expected empty string for secret field, got %q", got)
	}
}

// TestGetFindFieldValue_LabelMatch verifies case-insensitive label matching.
func TestGetFindFieldValue_LabelMatch(t *testing.T) {
	t.Parallel()
	val := "mypassword"
	it := &item{Fields: []itemField{
		{FieldDefKey: "password", Label: "Parola", IsSecret: false, ValuePlain: &val},
	}}
	if got := findFieldValue(it, "PAROLA"); got != val {
		t.Errorf("case-insensitive label match: expected %q, got %q", val, got)
	}
}

// TestGlobalFlags verifies persistent flags are defined on the root command.
func TestGlobalFlags(t *testing.T) {
	t.Parallel()
	flags := []string{"json", "quiet", "config"}
	for _, f := range flags {
		if rootCmd.PersistentFlags().Lookup(f) == nil {
			t.Errorf("persistent flag %q not found on rootCmd", f)
		}
	}
}
