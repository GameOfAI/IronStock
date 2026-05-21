// Package logfwd forwards audit log events to external targets
// (Syslog over UDP/TCP, Slack webhooks).
//
// The Manager is wired into the audit.Writer and receives every committed
// audit event. Each enabled LogForwardingConfig contributes one Forwarder
// that runs in a goroutine, draining its buffered channel.
package logfwd

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Event is a stripped-down copy of an audit log row passed to forwarders.
type Event struct {
	ID           string          `json:"id"`
	Action       string          `json:"action"`
	ActorUserID  *string         `json:"actor_user_id,omitempty"`
	ResourceType *string         `json:"resource_type,omitempty"`
	ResourceID   *string         `json:"resource_id,omitempty"`
	Details      json.RawMessage `json:"details,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// Forwarder sends a single Event to an external target.
type Forwarder interface {
	// Send delivers the event. Implementations should be non-blocking and
	// return quickly; the Manager calls this in a dedicated goroutine.
	Send(ctx context.Context, ev Event) error
	// Close releases resources (network connections, etc.).
	Close() error
	// ConfigID returns the DB row ID that produced this forwarder.
	ConfigID() string
}

// SyslogConfig holds parameters for a syslog target.
type SyslogConfig struct {
	Protocol string `json:"protocol"` // "udp" or "tcp"
	Host     string `json:"host"`
	Port     int    `json:"port"`
	// AppName is inserted as the syslog PROGRAM field (default: "ironstock").
	AppName string `json:"app_name,omitempty"`
}

// SlackConfig holds parameters for a Slack webhook target.
type SlackConfig struct {
	WebhookURL string `json:"webhook_url"`
	// Channel overrides the webhook's default channel (optional).
	Channel string `json:"channel,omitempty"`
	// Username overrides the bot display name (optional).
	Username string `json:"username,omitempty"`
}

// ParseSyslogConfig decodes JSONB config into SyslogConfig.
func ParseSyslogConfig(raw json.RawMessage) (SyslogConfig, error) {
	var c SyslogConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("logfwd: parse syslog config: %w", err)
	}
	if c.Host == "" {
		return c, fmt.Errorf("logfwd: syslog host is required")
	}
	if c.Port <= 0 || c.Port > 65535 {
		c.Port = 514
	}
	if c.Protocol != "tcp" {
		c.Protocol = "udp"
	}
	if c.AppName == "" {
		c.AppName = "ironstock"
	}
	return c, nil
}

// ParseConfig validates that configJSON can be decoded for the given targetType.
// Unlike BuildForwarder it does NOT dial any network address — safe for HTTP handlers.
func ParseConfig(targetType string, configJSON json.RawMessage) (any, error) {
	switch targetType {
	case "syslog":
		return ParseSyslogConfig(configJSON)
	case "slack":
		return ParseSlackConfig(configJSON)
	default:
		return nil, fmt.Errorf("logfwd: unknown target_type %q", targetType)
	}
}

// TestEvent returns a synthetic audit event for testing forwarder connectivity.
func TestEvent() Event {
	details, _ := json.Marshal(map[string]string{"test": "true"})
	return Event{
		ID:        "00000000-0000-0000-0000-000000000000",
		Action:    "log_forwarding.test",
		Details:   details,
		CreatedAt: time.Now(),
	}
}

// ParseSlackConfig decodes JSONB config into SlackConfig.
func ParseSlackConfig(raw json.RawMessage) (SlackConfig, error) {
	var c SlackConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("logfwd: parse slack config: %w", err)
	}
	if c.WebhookURL == "" {
		return c, fmt.Errorf("logfwd: slack webhook_url is required")
	}
	return c, nil
}
