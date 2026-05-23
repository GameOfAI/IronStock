// Package k8s provides a lightweight Kubernetes API client using only the
// standard library (net/http). No client-go dependency is required.
//
// Authentication modes:
//   - token: Bearer token from a ServiceAccount.
//   - kubeconfig: Parses a kubeconfig YAML file; supports cert-data and inline
//     token; rejects exec-based auth and file-path references.
package k8s

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// AuthMode represents how the client authenticates to the cluster.
type AuthMode string

const (
	AuthModeToken      AuthMode = "token"
	AuthModeKubeconfig AuthMode = "kubeconfig"
)

// ErrNotFound is returned when the requested resource does not exist.
var ErrNotFound = errors.New("k8s: resource not found")

// ErrForbidden is returned when the server rejects the request due to RBAC.
var ErrForbidden = errors.New("k8s: forbidden — check RBAC permissions")

// ErrMetricsUnavailable is returned when the metrics-server is not installed.
var ErrMetricsUnavailable = errors.New("k8s: metrics-server unavailable")

// Config holds the parameters needed to create a new Client.
type Config struct {
	ServerURL     string
	AuthMode      AuthMode
	BearerToken   string          // used when AuthMode == AuthModeToken
	Kubeconfig    *KubeconfigAuth // used when AuthMode == AuthModeKubeconfig, pre-parsed
	CACertPEM     string
	SkipTLSVerify bool
}

// Client wraps an http.Client configured for a specific Kubernetes cluster.
type Client struct {
	cfg    Config
	http   *http.Client
	bearer string // resolved token (from BearerToken or Kubeconfig.Token)
}

// New creates a Client from cfg, constructing the appropriate TLS configuration.
func New(cfg Config) (*Client, error) {
	tlsCfg := &tls.Config{
		InsecureSkipVerify: cfg.SkipTLSVerify, //nolint:gosec
	}

	// Set up CA cert pool.
	if cfg.CACertPEM != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(cfg.CACertPEM)) {
			return nil, errors.New("k8s: failed to parse CA certificate PEM")
		}
		tlsCfg.RootCAs = pool
	}

	bearer := cfg.BearerToken

	// For kubeconfig mode, override TLS settings from parsed auth.
	if cfg.AuthMode == AuthModeKubeconfig && cfg.Kubeconfig != nil {
		kc := cfg.Kubeconfig

		// Prefer kubeconfig CA over explicit CACertPEM.
		if kc.CACertPEM != "" {
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM([]byte(kc.CACertPEM)) {
				return nil, errors.New("k8s: failed to parse kubeconfig CA certificate PEM")
			}
			tlsCfg.RootCAs = pool
		}

		// Client certificate auth.
		if kc.ClientCert != "" && kc.ClientKey != "" {
			cert, err := tls.X509KeyPair([]byte(kc.ClientCert), []byte(kc.ClientKey))
			if err != nil {
				return nil, fmt.Errorf("k8s: failed to parse client cert/key: %w", err)
			}
			tlsCfg.Certificates = append(tlsCfg.Certificates, cert)
		}

		if kc.Token != "" {
			bearer = kc.Token
		}

		// Use the kubeconfig server URL if set.
		if kc.ServerURL != "" {
			cfg.ServerURL = kc.ServerURL
		}
	}

	transport := &http.Transport{TLSClientConfig: tlsCfg}
	httpClient := &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}

	return &Client{
		cfg:    cfg,
		http:   httpClient,
		bearer: bearer,
	}, nil
}

// doRequest performs an authenticated GET request against the given K8s API path
// and decodes the response body into out.
func (c *Client) doRequest(ctx context.Context, path string, out any) error {
	url := c.cfg.ServerURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("k8s: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("k8s: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return fmt.Errorf("k8s: read response: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		// continue
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusForbidden, http.StatusUnauthorized:
		return ErrForbidden
	case http.StatusServiceUnavailable:
		// metrics-server typically returns 503 when unavailable
		if path != "" {
			return ErrMetricsUnavailable
		}
		return fmt.Errorf("k8s: server returned %d", resp.StatusCode)
	default:
		return fmt.Errorf("k8s: server returned %d: %s", resp.StatusCode, truncate(string(body), 256))
	}

	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("k8s: decode response: %w", err)
	}
	return nil
}

// GetServerVersion calls GET /version and returns the raw body (for connectivity tests).
func (c *Client) GetServerVersion(ctx context.Context) (map[string]any, error) {
	var v map[string]any
	if err := c.doRequest(ctx, "/version", &v); err != nil {
		return nil, err
	}
	return v, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
