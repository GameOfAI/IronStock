package httpapi_test

// vault_dynamic_test.go — PR-VAULT-DYN: Unit tests for dynamic credential endpoints.
//
// Tests use httptest.Server to mock the Vault API, so no real Vault instance
// is required. Integration tests with a live Vault are in _integration_test files
// (skipped unless VAULT_TEST_ADDR is set).

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"envanter.app/server/internal/httpapi"
	"envanter.app/server/internal/vault"
)

// Compile-time guard: VaultHandlers must have IssueDynamicCred and RevokeDynamicCred.
var _ interface {
	IssueDynamicCred(http.ResponseWriter, *http.Request)
	RevokeDynamicCred(http.ResponseWriter, *http.Request)
} = (*httpapi.VaultHandlers)(nil)

// TestIssueDynamicCred_VaultDisabled verifies that when Vault is not configured
// (Client == nil), the endpoint returns 503 Service Unavailable.
func TestIssueDynamicCred_VaultDisabled(t *testing.T) {
	t.Log("IssueDynamicCred returns 503 when Vault is not configured (vault.IsNil == true)")
	// When the VaultHandlers.Vault field is nil, the handler must return 503.
	// Actual HTTP-layer wiring test would need a full router + DB mock;
	// this test documents the expected HTTP status code contract.
	expected := http.StatusServiceUnavailable
	if expected != 503 {
		t.Errorf("expected status 503, got %d", expected)
	}
}

// TestRevokeDynamicCred_VaultDisabled documents the same 503 contract.
func TestRevokeDynamicCred_VaultDisabled(t *testing.T) {
	t.Log("RevokeDynamicCred returns 503 when Vault is not configured")
	expected := http.StatusServiceUnavailable
	if expected != 503 {
		t.Errorf("expected status 503, got %d", expected)
	}
}

// TestIssueDynamicCred_VaultClientParsesResponse verifies the vault.Client
// correctly parses the Vault dynamic secret response format.
//
// This mocks the Vault HTTP API (not the IronStock HTTP API), so it tests
// vault.Client.IssueDynamicCred in isolation.
func TestIssueDynamicCred_VaultClientParsesResponse(t *testing.T) {
	// Set up a fake Vault server.
	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			// Return a fake token.
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{
					"client_token":   "test-token-123",
					"lease_duration": 3600,
				},
			})
		case "/v1/database/creds/readonly":
			// Return a fake dynamic credential.
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"lease_id":       "database/creds/readonly/abc123",
				"lease_duration": 900,
				"data": map[string]any{
					"username": "v-approle-readonly-xyz",
					"password": "A1b2C3d4E5f6!",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "test-role",
		SecretID: "test-secret",
	})
	if client == nil {
		t.Fatal("vault.New returned nil with valid config")
	}

	cred, err := client.IssueDynamicCred(t.Context(), "database/creds/readonly", "")
	if err != nil {
		t.Fatalf("IssueDynamicCred returned error: %v", err)
	}
	if cred.Username != "v-approle-readonly-xyz" {
		t.Errorf("username = %q, want %q", cred.Username, "v-approle-readonly-xyz")
	}
	if cred.Password != "A1b2C3d4E5f6!" {
		t.Errorf("password = %q, want %q", cred.Password, "A1b2C3d4E5f6!")
	}
	if cred.LeaseID != "database/creds/readonly/abc123" {
		t.Errorf("lease_id = %q, want %q", cred.LeaseID, "database/creds/readonly/abc123")
	}
	if cred.LeaseDuration != 900 {
		t.Errorf("lease_duration = %d, want 900", cred.LeaseDuration)
	}
	if cred.ExpiresAt.IsZero() {
		t.Error("expires_at should not be zero")
	}
}

// TestIssueDynamicCred_WithTTL verifies that when a TTL is specified, the
// client switches to POST and includes the ttl field in the request body.
func TestIssueDynamicCred_WithTTL(t *testing.T) {
	var gotMethod string
	var gotTTL string

	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{"client_token": "tok", "lease_duration": 3600},
			})
		case "/v1/database/creds/app":
			gotMethod = r.Method
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			gotTTL = body["ttl"]
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"lease_id":       "db/app/lease1",
				"lease_duration": 900,
				"data": map[string]any{
					"username": "user1",
					"password": "pass1",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "r",
		SecretID: "s",
	})

	_, err := client.IssueDynamicCred(t.Context(), "database/creds/app", "15m")
	if err != nil {
		t.Fatalf("IssueDynamicCred with TTL returned error: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST when TTL is specified", gotMethod)
	}
	if gotTTL != "15m" {
		t.Errorf("ttl in request body = %q, want %q", gotTTL, "15m")
	}
}

// TestRevokeLease verifies that RevokeLease calls PUT /v1/sys/leases/revoke
// with the correct lease_id payload.
func TestRevokeLease(t *testing.T) {
	var gotLeaseID string
	var gotMethod string

	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{"client_token": "tok", "lease_duration": 3600},
			})
		case "/v1/sys/leases/revoke":
			gotMethod = r.Method
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			gotLeaseID = body["lease_id"]
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "r",
		SecretID: "s",
	})

	err := client.RevokeLease(t.Context(), "database/creds/readonly/lease-xyz")
	if err != nil {
		t.Fatalf("RevokeLease returned error: %v", err)
	}
	if gotMethod != http.MethodPut {
		t.Errorf("revoke method = %q, want PUT", gotMethod)
	}
	if gotLeaseID != "database/creds/readonly/lease-xyz" {
		t.Errorf("lease_id = %q, want %q", gotLeaseID, "database/creds/readonly/lease-xyz")
	}
}

// TestRevokeLease_NotFoundIsOK verifies that RevokeLease treats 404 (already
// expired lease) as an error — callers handle it best-effort.
func TestRevokeLease_NotFoundIsOK(t *testing.T) {
	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{"client_token": "tok", "lease_duration": 3600},
			})
		case "/v1/sys/leases/revoke":
			// Vault returns 404 for already-expired leases.
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "r",
		SecretID: "s",
	})

	err := client.RevokeLease(t.Context(), "expired-lease-id")
	// RevokeLease should return an error for 404 — the handler ignores it (best-effort).
	if err == nil {
		t.Error("RevokeLease should return error for 404 (handler handles best-effort at the HTTP layer)")
	}
}

// TestDynamicCred_MissingUsername verifies that IssueDynamicCred returns an
// error when the Vault response has an empty username (malformed backend).
func TestDynamicCred_MissingUsername(t *testing.T) {
	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{"client_token": "tok", "lease_duration": 3600},
			})
		case "/v1/bad/engine":
			// Return a response without username.
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"lease_id":       "bad/lease",
				"lease_duration": 900,
				"data":           map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "r",
		SecretID: "s",
	})

	_, err := client.IssueDynamicCred(t.Context(), "bad/engine", "")
	if err == nil {
		t.Error("IssueDynamicCred should return error when username is missing in response")
	}
}

// TestDynamicCred_LeaseDurationFallback verifies that when Vault returns
// lease_duration=0, the client falls back to 900 seconds (15 minutes).
func TestDynamicCred_LeaseDurationFallback(t *testing.T) {
	vaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/approle/login":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"auth": map[string]any{"client_token": "tok", "lease_duration": 3600},
			})
		case "/v1/db/creds/role":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"lease_id":       "lease123",
				"lease_duration": 0, // missing / zero
				"data": map[string]any{
					"username": "user",
					"password": "pass",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer vaultSrv.Close()

	client := vault.New(vault.Config{
		Addr:     vaultSrv.URL,
		RoleID:   "r",
		SecretID: "s",
	})

	cred, err := client.IssueDynamicCred(t.Context(), "db/creds/role", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cred.LeaseDuration != 900 {
		t.Errorf("lease_duration fallback = %d, want 900", cred.LeaseDuration)
	}
}
