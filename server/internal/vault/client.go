// Package vault provides a lightweight HashiCorp Vault HTTP client for
// server-side Vault proxy (PR-VAULT, ADR-0007).
//
// Security model:
//   - Plaintext secret values are returned only to the caller and MUST NOT
//     be stored or logged. The server is a pass-through proxy.
//   - AppRole credentials (role_id + secret_id) come from environment
//     variables via config.Config; they are never logged.
//   - Token leases are cached and refreshed transparently at 75% TTL.
//   - All errors are returned without Vault token or secret material.
package vault

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Sentinel errors.
var (
	// ErrVaultDisabled is returned when the Vault client is nil (not configured).
	ErrVaultDisabled = errors.New("vault: not configured")
	// ErrSecretNotFound is returned when the Vault KV path does not exist (404).
	ErrSecretNotFound = errors.New("vault: secret not found")
	// ErrForbidden is returned when the Vault token has no access to the path.
	ErrForbidden = errors.New("vault: forbidden — check AppRole policy")
)

// Config holds the AppRole credentials needed to connect to Vault.
// All three fields (Addr, RoleID, SecretID) must be non-empty for
// Configured() to return true.
type Config struct {
	Addr      string // https://vault.cluster.local:8200
	RoleID    string // AppRole role_id
	SecretID  string // AppRole secret_id
	Namespace string // Vault Enterprise namespace (optional)
}

// Configured returns true when all required fields are set.
func (c Config) Configured() bool {
	return c.Addr != "" && c.RoleID != "" && c.SecretID != ""
}

// ExternalSourceVault is stored in items.external_source JSONB and
// describes how to fetch this item's secrets from Vault.
//
// The server never stores or logs secret values, only this metadata.
type ExternalSourceVault struct {
	Type      string            `json:"type"`        // must be "vault"
	Mount     string            `json:"mount"`       // KV secrets engine mount, e.g. "secret"
	Path      string            `json:"path"`        // KV path relative to mount, e.g. "prod/db/postgres"
	KVVersion int               `json:"kv_version"`  // 1 or 2 (default 2)
	KeyMapping map[string]string `json:"key_mapping"` // field_definition.key → vault data key
}

// Client is a thread-safe Vault HTTP client with automatic AppRole token
// renewal. The zero-value is not usable — create via New.
type Client struct {
	cfg    Config
	http   *http.Client
	mu     sync.Mutex
	token  string
	expiry time.Time
}

// New creates a Client from cfg. Returns nil when cfg.Configured() is false
// so callers can treat nil Client as "vault disabled" without extra logic.
func New(cfg Config) *Client {
	if !cfg.Configured() {
		return nil
	}
	return &Client{
		cfg: cfg,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// IsNil returns true when c is nil (Vault not configured).
// Exists as a named helper for readability at call sites.
func IsNil(c *Client) bool { return c == nil }

// ReadKV fetches secret data at src.Mount/src.Path and applies
// src.KeyMapping. Returns a map of field_definition.key → plaintext value.
//
// KV v2: GET /v1/{mount}/data/{path} → nested data.data object.
// KV v1: GET /v1/{mount}/{path}      → flat data object.
//
// Only keys present in key_mapping are included in the result.
// If key_mapping is empty, all Vault keys are returned as-is.
func (c *Client) ReadKV(ctx context.Context, src ExternalSourceVault) (map[string]string, error) {
	if err := c.ensureToken(ctx); err != nil {
		return nil, fmt.Errorf("vault auth: %w", err)
	}

	kvVersion := src.KVVersion
	if kvVersion == 0 {
		kvVersion = 2
	}

	var apiPath string
	if kvVersion == 2 {
		apiPath = fmt.Sprintf("/v1/%s/data/%s", src.Mount, strings.TrimPrefix(src.Path, "/"))
	} else {
		apiPath = fmt.Sprintf("/v1/%s/%s", src.Mount, strings.TrimPrefix(src.Path, "/"))
	}

	body, err := c.doRequest(ctx, http.MethodGet, apiPath, nil)
	if err != nil {
		return nil, err
	}

	// Parse response into generic map.
	var resp struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("vault: parse response: %w", err)
	}

	// KV v2 wraps the actual data in a nested "data" key.
	var rawData map[string]interface{}
	if kvVersion == 2 {
		var outer struct {
			Data map[string]interface{} `json:"data"`
		}
		if err := json.Unmarshal(resp.Data, &outer); err != nil {
			return nil, fmt.Errorf("vault: parse kv2 data: %w", err)
		}
		rawData = outer.Data
	} else {
		if err := json.Unmarshal(resp.Data, &rawData); err != nil {
			return nil, fmt.Errorf("vault: parse kv1 data: %w", err)
		}
	}

	// Apply key_mapping or return all keys.
	out := make(map[string]string, len(src.KeyMapping))
	if len(src.KeyMapping) == 0 {
		// No mapping: return all top-level keys.
		for vaultKey, val := range rawData {
			out[vaultKey] = stringify(val)
		}
	} else {
		for fieldKey, vaultKey := range src.KeyMapping {
			if val, ok := rawData[vaultKey]; ok {
				out[fieldKey] = stringify(val)
			}
		}
	}
	return out, nil
}

// ListPaths returns the keys/sub-paths at vault LIST /v1/{mount}/metadata/{prefix}.
// Admin-only in the API layer; Vault also enforces its own policy.
func (c *Client) ListPaths(ctx context.Context, mount, prefix string) ([]string, error) {
	if err := c.ensureToken(ctx); err != nil {
		return nil, fmt.Errorf("vault auth: %w", err)
	}

	prefix = strings.TrimPrefix(prefix, "/")
	apiPath := fmt.Sprintf("/v1/%s/metadata/%s", mount, prefix)

	body, err := c.doRequest(ctx, "LIST", apiPath, nil)
	if err != nil {
		if errors.Is(err, ErrSecretNotFound) {
			// Empty prefix — return empty list, not an error.
			return []string{}, nil
		}
		return nil, err
	}

	var resp struct {
		Data struct {
			Keys []string `json:"keys"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("vault: parse list response: %w", err)
	}
	return resp.Data.Keys, nil
}

// ensureToken acquires or refreshes the Vault token under a mutex.
// Refresh happens when the token has less than 30 seconds remaining.
func (c *Client) ensureToken(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Until(c.expiry) > 30*time.Second {
		return nil
	}
	return c.authenticate(ctx)
}

// authenticate performs AppRole login and caches the resulting token.
// Expiry is set to 75% of the lease_duration to allow proactive refresh.
func (c *Client) authenticate(ctx context.Context) error {
	payload, _ := json.Marshal(map[string]string{
		"role_id":   c.cfg.RoleID,
		"secret_id": c.cfg.SecretID,
	})

	body, err := c.doRequestRaw(ctx, http.MethodPost, "/v1/auth/approle/login", payload)
	if err != nil {
		return fmt.Errorf("approle login: %w", err)
	}

	var resp struct {
		Auth struct {
			ClientToken   string `json:"client_token"`
			LeaseDuration int    `json:"lease_duration"` // seconds
		} `json:"auth"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("parse auth response: %w", err)
	}
	if resp.Auth.ClientToken == "" {
		return errors.New("vault: empty client_token in auth response")
	}

	c.token = resp.Auth.ClientToken
	// Cache at 75% TTL; fall back to 15 min if lease_duration is 0.
	leaseSecs := resp.Auth.LeaseDuration
	if leaseSecs == 0 {
		leaseSecs = 900
	}
	c.expiry = time.Now().Add(time.Duration(float64(leaseSecs)*0.75) * time.Second)
	return nil
}

// doRequest sends an authenticated request and returns the response body.
// It handles 404 → ErrSecretNotFound and 403 → ErrForbidden automatically.
func (c *Client) doRequest(ctx context.Context, method, path string, payload []byte) ([]byte, error) {
	c.mu.Lock()
	token := c.token
	c.mu.Unlock()

	req, err := c.buildRequest(ctx, method, path, payload, token)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vault: http: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("vault: read body: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusNotFound:
		return nil, ErrSecretNotFound
	case http.StatusForbidden, http.StatusUnauthorized:
		return nil, ErrForbidden
	default:
		// Try to extract Vault's error message.
		var errResp struct {
			Errors []string `json:"errors"`
		}
		if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil && len(errResp.Errors) > 0 {
			return nil, fmt.Errorf("vault: %s (status %d): %s", path, resp.StatusCode, strings.Join(errResp.Errors, "; "))
		}
		return nil, fmt.Errorf("vault: unexpected status %d at %s", resp.StatusCode, path)
	}
}

// doRequestRaw is like doRequest but does NOT add the X-Vault-Token header.
// Used for the login endpoint before a token exists.
func (c *Client) doRequestRaw(ctx context.Context, method, path string, payload []byte) ([]byte, error) {
	req, err := c.buildRequest(ctx, method, path, payload, "")
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vault: http: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("vault: read body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Errors []string `json:"errors"`
		}
		if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil && len(errResp.Errors) > 0 {
			return nil, fmt.Errorf("vault: %s (status %d): %s", path, resp.StatusCode, strings.Join(errResp.Errors, "; "))
		}
		return nil, fmt.Errorf("vault: unexpected status %d at %s", resp.StatusCode, path)
	}
	return body, nil
}

func (c *Client) buildRequest(ctx context.Context, method, path string, payload []byte, token string) (*http.Request, error) {
	url := strings.TrimRight(c.cfg.Addr, "/") + path

	var bodyReader io.Reader
	if payload != nil {
		bodyReader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("vault: build request: %w", err)
	}

	if token != "" {
		req.Header.Set("X-Vault-Token", token)
	}
	if c.cfg.Namespace != "" {
		req.Header.Set("X-Vault-Namespace", c.cfg.Namespace)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// stringify converts any JSON value to its string representation.
// Strings are returned as-is; numbers, booleans, null become their
// JSON text representation.
func stringify(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case nil:
		return ""
	default:
		b, _ := json.Marshal(val)
		return string(b)
	}
}
