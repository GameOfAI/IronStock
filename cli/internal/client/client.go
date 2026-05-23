// Package client provides an HTTP client for the IronStock REST API.
//
// It handles:
//   - Bearer token injection (access token from config)
//   - Automatic token refresh on 401 (using the refresh token)
//   - JSON encode/decode helpers
//   - TLS configuration
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"ironstock.app/cli/internal/config"
)

// Client wraps http.Client with IronStock-specific helpers.
type Client struct {
	BaseURL      string
	AccessToken  string
	RefreshToken string
	HTTP         *http.Client
}

// New creates a Client from the saved config + tokens.
func New() (*Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	access, refresh, err := config.LoadTokens()
	if err != nil {
		return nil, fmt.Errorf("client: load tokens: %w", err)
	}
	return &Client{
		BaseURL:      strings.TrimRight(cfg.ServerURL, "/"),
		AccessToken:  access,
		RefreshToken: refresh,
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// NewWithCreds creates a Client for initial login (no tokens yet).
func NewWithCreds(serverURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(serverURL, "/"),
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Do sends an authenticated request. On 401 it tries one token refresh.
func (c *Client) Do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	resp, err := c.doOnce(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized && c.RefreshToken != "" {
		resp.Body.Close()
		if rerr := c.refresh(ctx); rerr == nil {
			resp, err = c.doOnce(ctx, method, path, body)
			if err != nil {
				return nil, err
			}
		}
	}
	return resp, nil
}

func (c *Client) doOnce(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var bodyR io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("client: marshal body: %w", err)
		}
		bodyR = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bodyR)
	if err != nil {
		return nil, fmt.Errorf("client: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	}
	return c.HTTP.Do(req)
}

// refresh attempts to get a new access token using the refresh token.
func (c *Client) refresh(ctx context.Context) error {
	payload := map[string]string{"refresh_token": c.RefreshToken}
	resp, err := c.doOnce(ctx, http.MethodPost, "/api/v1/auth/refresh", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("client: refresh failed: %d", resp.StatusCode)
	}
	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("client: refresh decode: %w", err)
	}
	c.AccessToken = result.AccessToken
	if result.RefreshToken != "" {
		c.RefreshToken = result.RefreshToken
	}
	return config.SaveTokens(c.AccessToken, c.RefreshToken)
}

// JSON is a helper that decodes a successful JSON response into dst.
// It returns an APIError if the status code is not in the 2xx range.
func JSON(resp *http.Response, dst any) error {
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var apiErr APIError
		_ = json.NewDecoder(resp.Body).Decode(&apiErr)
		apiErr.StatusCode = resp.StatusCode
		if apiErr.Message == "" {
			apiErr.Message = http.StatusText(resp.StatusCode)
		}
		return &apiErr
	}
	if dst == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

// APIError represents an error response from the server.
type APIError struct {
	StatusCode int    `json:"-"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("server error %d: %s", e.StatusCode, e.Message)
}

// Drain reads and discards the body, returning any error.
// Useful after sending a request when the response body is not needed.
func Drain(resp *http.Response) error {
	defer resp.Body.Close()
	_, err := io.Copy(io.Discard, resp.Body)
	return err
}
