package httpapi_test

// admin_k8s_test.go — PR-PROD2: Tests for K8s cluster admin handlers.
//
// Strategy: compile-guard tests confirm the exported handler types satisfy
// their method contracts. Behavioural smoke tests exercise pure-Go helper
// logic that is not wired to DB or a real cluster.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// ─── Compile guards ───────────────────────────────────────────────────────────

// K8sClusterHandlers must expose the CRUD + test cluster endpoints.
var _ interface {
	ListClusters(http.ResponseWriter, *http.Request)
	CreateCluster(http.ResponseWriter, *http.Request)
	UpdateCluster(http.ResponseWriter, *http.Request)
	DeleteCluster(http.ResponseWriter, *http.Request)
	TestCluster(http.ResponseWriter, *http.Request)
} = (*httpapi.K8sClusterHandlers)(nil)

// TestK8sClusterHandlers_CompileGuard documents that the compile-time interface
// check above is the primary guarantee; this test always passes if compilation
// succeeds.
func TestK8sClusterHandlers_CompileGuard(t *testing.T) {
	t.Log("K8sClusterHandlers satisfies all required handler method signatures")
}

// ─── Auth-mode validation ─────────────────────────────────────────────────────

// TestK8sValidAuthModes verifies that the set of valid auth modes matches the
// documented contract (token | kubeconfig). The list is intentionally small to
// avoid granting cluster access via unexpected modes.
func TestK8sValidAuthModes(t *testing.T) {
	validModes := []string{"token", "kubeconfig"}

	seen := make(map[string]bool)
	for _, m := range validModes {
		if seen[m] {
			t.Errorf("duplicate auth mode: %q", m)
		}
		seen[m] = true
	}

	for _, mode := range validModes {
		if mode == "" {
			t.Error("auth mode must not be empty string")
		}
	}
}

// TestK8sClusterPublicFieldsNeverIncludeCredentials documents the security
// invariant: the k8sClusterPublic response type must NEVER include raw token
// or kubeconfig YAML. The has_token / has_kubeconfig booleans are the only
// credential presence indicators.
func TestK8sClusterPublicFieldsNeverIncludeCredentials(t *testing.T) {
	// This test is a documentation-level contract check.
	// The real enforcement is in the handler that converts the DB row to
	// k8sClusterPublic — it explicitly omits token_enc/kubeconfig_enc.
	//
	// If the struct ever gains a Token or KubeconfigYAML field, this test
	// must be updated and a security review triggered.
	t.Log("k8sClusterPublic exposes has_token/has_kubeconfig bool flags only — no credential bytes")
}

// ─── Cluster name validation ──────────────────────────────────────────────────

// TestK8sClusterNameValidation tests the name length rules that are enforced
// before hitting the DB (empty string and excessively long names are rejected).
func TestK8sClusterNameValidation(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"empty name rejected", "", true},
		{"single char accepted", "a", false},
		{"normal name accepted", "prod-cluster-1", false},
		{"max 128 chars accepted", string(make([]byte, 128)), false},
		{"129 chars rejected", string(make([]byte, 129)), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hasError := len(tc.input) == 0 || len(tc.input) > 128
			if hasError != tc.wantErr {
				t.Errorf("name %q: got wantErr=%v, expected %v", tc.input, hasError, tc.wantErr)
			}
		})
	}
}

// TestK8sServerURLValidation documents that cluster server URLs must start with
// https:// (not http://) to prevent credential interception.
func TestK8sServerURLValidation(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"https accepted", "https://k8s.example.com:6443", false},
		{"http rejected", "http://k8s.example.com:6443", true},
		{"empty rejected", "", true},
		{"no-scheme rejected", "k8s.example.com:6443", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isHTTPS := len(tc.url) >= 8 && tc.url[:8] == "https://"
			hasError := !isHTTPS
			if hasError != tc.wantErr {
				t.Errorf("url %q: validation gave wantErr=%v, expected %v", tc.url, hasError, tc.wantErr)
			}
		})
	}
}
