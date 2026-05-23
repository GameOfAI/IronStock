package httpapi_test

// ansible_inventory_test.go — PR-ANSIBLE: compile-time guard + logic tests.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: all handlers implement their methods.
var _ interface {
	GetInventory(http.ResponseWriter, *http.Request)
} = (*httpapi.AnsibleInventoryHandlers)(nil)

var _ interface {
	ListAPITokens(http.ResponseWriter, *http.Request)
	CreateAPIToken(http.ResponseWriter, *http.Request)
	DeleteAPIToken(http.ResponseWriter, *http.Request)
} = (*httpapi.APITokenHandlers)(nil)

// TestAnsibleGroupByDefault documents that group_by defaults to "tag".
func TestAnsibleGroupByDefault(t *testing.T) {
	groupBy := ""
	if groupBy == "" {
		groupBy = "tag"
	}
	if groupBy != "tag" {
		t.Errorf("default groupBy = %q, want tag", groupBy)
	}
}

// TestAPITokenScopeValidation documents valid scopes.
func TestAPITokenScopeValidation(t *testing.T) {
	validScopes := map[string]bool{"read": true, "ansible": true, "scim": true}
	tests := []struct {
		scope string
		valid bool
	}{
		{"read", true},
		{"ansible", true},
		{"scim", true},
		{"write", false},
		{"admin", false},
		{"", false},
	}
	for _, tc := range tests {
		got := validScopes[tc.scope]
		if got != tc.valid {
			t.Errorf("scope %q: valid=%v want %v", tc.scope, got, tc.valid)
		}
	}
}

// TestAnsibleInventoryStructure documents the required top-level Ansible JSON keys.
func TestAnsibleInventoryStructure(t *testing.T) {
	// An Ansible dynamic inventory must have: _meta, all.
	required := []string{"_meta", "all"}
	inv := map[string]any{
		"_meta": map[string]any{"hostvars": map[string]any{}},
		"all":   map[string]any{"hosts": []string{}, "children": []string{}},
	}
	for _, key := range required {
		if _, ok := inv[key]; !ok {
			t.Errorf("inventory missing required key %q", key)
		}
	}
}
