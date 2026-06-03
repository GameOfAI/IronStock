package logfwd

// splunk.go — PR-SIEM: Splunk HTTP Event Collector (HEC) forwarder.
//
// Sends audit events to Splunk HEC as JSON events.
// Splunk HEC endpoint: POST https://<host>:<port>/services/collector/event
// Auth header: Authorization: Splunk <token>
//
// Retry policy: up to 3 attempts with exponential backoff (1s, 2s).
// On repeated failure, the event is dropped and a warning is logged.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// SplunkConfig holds parameters for a Splunk HEC target.
type SplunkConfig struct {
	// URL is the full HEC collector endpoint, e.g.
	// https://splunk.internal:8088/services/collector/event
	URL string `json:"url"`
	// Token is the HEC token (without the "Splunk " prefix).
	Token string `json:"token"`
	// Index is the optional Splunk index to write to.
	Index string `json:"index,omitempty"`
	// Source is the optional Splunk source field.
	Source string `json:"source,omitempty"`
	// SourceType is the optional Splunk sourcetype field.
	SourceType string `json:"source_type,omitempty"`
	// TLSInsecureSkipVerify disables TLS certificate verification (dev only).
	TLSInsecureSkipVerify bool `json:"tls_insecure_skip_verify,omitempty"`
}

// splunkHECEvent is the Splunk HEC JSON envelope.
type splunkHECEvent struct {
	Time       float64         `json:"time"`
	Index      string          `json:"index,omitempty"`
	Source     string          `json:"source,omitempty"`
	SourceType string          `json:"sourcetype,omitempty"`
	Host       string          `json:"host,omitempty"`
	Event      json.RawMessage `json:"event"`
}

// SplunkForwarder sends events to Splunk via HEC.
type SplunkForwarder struct {
	configID string
	cfg      SplunkConfig
	client   *http.Client
}

// NewSplunkForwarder creates a new Splunk HEC forwarder.
func NewSplunkForwarder(configID string, cfg SplunkConfig) *SplunkForwarder {
	return &SplunkForwarder{
		configID: configID,
		cfg:      cfg,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ConfigID implements Forwarder.
func (f *SplunkForwarder) ConfigID() string { return f.configID }

// Close implements Forwarder.
func (*SplunkForwarder) Close() error { return nil }

// Send implements Forwarder — delivers the event to Splunk HEC with retry.
func (f *SplunkForwarder) Send(ctx context.Context, ev Event) error {
	// Marshal the event payload.
	eventJSON, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("splunk: marshal event: %w", err)
	}

	hecEvent := splunkHECEvent{
		Time:       float64(ev.CreatedAt.UnixNano()) / 1e9,
		Index:      f.cfg.Index,
		Source:     f.cfg.Source,
		SourceType: f.cfg.SourceType,
		Host:       "ironstock",
		Event:      eventJSON,
	}
	body, err := json.Marshal(hecEvent)
	if err != nil {
		return fmt.Errorf("splunk: marshal HEC envelope: %w", err)
	}

	return retryPost(ctx, f.client, f.cfg.URL,
		"Splunk "+f.cfg.Token,
		"application/json", body, 3)
}

// ParseSplunkConfig decodes JSONB config into SplunkConfig.
func ParseSplunkConfig(raw json.RawMessage) (SplunkConfig, error) {
	var c SplunkConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("logfwd: parse splunk config: %w", err)
	}
	if c.URL == "" {
		return c, fmt.Errorf("logfwd: splunk url is required")
	}
	if c.Token == "" {
		return c, fmt.Errorf("logfwd: splunk token is required")
	}
	if c.SourceType == "" {
		c.SourceType = "ironstock:audit"
	}
	return c, nil
}

// retryPost POSTs body with exponential backoff (maxAttempts).
func retryPost(ctx context.Context, client *http.Client, url, authHdr, contentType string, body []byte, maxAttempts int) error {
	var lastErr error
	backoff := time.Second
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
				backoff *= 2
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("logfwd: build request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		if authHdr != "" {
			req.Header.Set("Authorization", authHdr)
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		lastErr = fmt.Errorf("logfwd: HTTP %d", resp.StatusCode)
		// 4xx errors (bad token etc.) — don't retry.
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return lastErr
		}
	}
	return fmt.Errorf("logfwd: all %d attempts failed: %w", maxAttempts, lastErr)
}
