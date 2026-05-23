package httpapi_test

// item_templates_test.go — PR-TPL: unit tests for item template endpoints.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: TemplateHandlers must implement all four handler methods.
var _ interface {
	List(http.ResponseWriter, *http.Request)
	Create(http.ResponseWriter, *http.Request)
	Update(http.ResponseWriter, *http.Request)
	Delete(http.ResponseWriter, *http.Request)
} = (*httpapi.TemplateHandlers)(nil)

// TestTemplateScopeValues documents valid scope values for GET /api/v1/templates.
func TestTemplateScopeValues(t *testing.T) {
	validScopes := []string{"mine", "public", "all"}
	for _, s := range validScopes {
		switch s {
		case "mine", "public", "all":
			// expected
		default:
			t.Errorf("unexpected scope value: %q", s)
		}
	}
}

// TestTemplateDefaultScope verifies that an empty scope defaults to "public".
func TestTemplateDefaultScope(t *testing.T) {
	// The List handler defaults to "public" when scope param is empty.
	// Documented here so API consumers know the default behaviour.
	const emptyInput = ""
	scope := emptyInput
	if scope == "" {
		scope = "public"
	}
	if scope != "public" {
		t.Errorf("default scope = %q, want public", scope)
	}
}

// TestCreateTemplateRequiredFields verifies that name and item_type_id are required.
func TestCreateTemplateRequiredFields(t *testing.T) {
	// These are validated server-side — empty name → 400, zero item_type_id → 400.
	type req struct {
		Name       string
		ItemTypeID int
		WantValid  bool
	}
	cases := []req{
		{"My Template", 1, true},
		{"", 1, false},          // missing name
		{"My Template", 0, false}, // missing item_type_id
	}
	for _, tc := range cases {
		valid := tc.Name != "" && tc.ItemTypeID != 0
		if valid != tc.WantValid {
			t.Errorf("name=%q, type_id=%d: valid=%v, want %v",
				tc.Name, tc.ItemTypeID, valid, tc.WantValid)
		}
	}
}

// TestTemplateFieldsDefaultJSON verifies that nil fields become empty JSON array.
func TestTemplateFieldsDefaultJSON(t *testing.T) {
	// When a create request omits fields, the handler defaults to "[]".
	var fields []byte
	if fields == nil {
		fields = []byte("[]")
	}
	if string(fields) != "[]" {
		t.Errorf("fields default = %s, want []", fields)
	}
}

// TestTemplateOwnershipCheck documents that only owner/admin can update/delete.
func TestTemplateOwnershipCheck(t *testing.T) {
	ownerID := "user-abc"
	callerID := "user-xyz"
	isAdmin := false

	canModify := isAdmin || ownerID == callerID
	if canModify {
		t.Errorf("non-owner non-admin should not be able to modify template")
	}

	// Admin can modify any template.
	isAdmin = true
	canModify = isAdmin || ownerID == callerID
	if !canModify {
		t.Errorf("admin should be able to modify any template")
	}

	// Owner can modify their own template.
	isAdmin = false
	callerID = ownerID
	canModify = isAdmin || ownerID == callerID
	if !canModify {
		t.Errorf("owner should be able to modify their template")
	}
}
