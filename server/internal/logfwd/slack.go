package logfwd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// SlackForwarder posts audit events to a Slack incoming webhook.
type SlackForwarder struct {
	id     string
	cfg    SlackConfig
	client *http.Client
}

// NewSlackForwarder creates a ready Slack forwarder.
func NewSlackForwarder(configID string, cfg SlackConfig) *SlackForwarder {
	return &SlackForwarder{
		id:     configID,
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// ConfigID implements Forwarder.
func (f *SlackForwarder) ConfigID() string { return f.id }

// Close implements Forwarder (no-op for HTTP client).
func (*SlackForwarder) Close() error { return nil }

type slackPayload struct {
	Username    string            `json:"username,omitempty"`
	Channel     string            `json:"channel,omitempty"`
	Attachments []slackAttachment `json:"attachments"`
}

type slackAttachment struct {
	Color  string       `json:"color"`
	Title  string       `json:"title"`
	Fields []slackField `json:"fields"`
	Footer string       `json:"footer"`
	Ts     int64        `json:"ts"`
}

type slackField struct {
	Title string `json:"title"`
	Value string `json:"value"`
	Short bool   `json:"short"`
}

// Send implements Forwarder.
func (f *SlackForwarder) Send(ctx context.Context, ev Event) error {
	actorID := "system"
	if ev.ActorUserID != nil {
		actorID = *ev.ActorUserID
	}

	fields := []slackField{
		{Title: "Action", Value: ev.Action, Short: true},
		{Title: "Actor", Value: actorID, Short: true},
	}
	if ev.ResourceType != nil {
		v := *ev.ResourceType
		if ev.ResourceID != nil {
			v += " / " + *ev.ResourceID
		}
		fields = append(fields, slackField{Title: "Resource", Value: v, Short: true})
	}
	if len(ev.Details) > 0 && string(ev.Details) != "null" {
		fields = append(fields, slackField{
			Title: "Details",
			Value: "```" + string(ev.Details) + "```",
			Short: false,
		})
	}

	color := "#36a64f" // green — informational
	switch {
	case isHighSeverityAction(ev.Action):
		color = "#ff0000" // red — critical
	case isMediumSeverityAction(ev.Action):
		color = "#ff9900" // orange — warning
	}

	payload := slackPayload{
		Username: f.cfg.Username,
		Channel:  f.cfg.Channel,
		Attachments: []slackAttachment{
			{
				Color:  color,
				Title:  "IronStock Audit Event",
				Fields: fields,
				Footer: "IronStock • " + ev.ID,
				Ts:     ev.CreatedAt.Unix(),
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("logfwd: slack marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.cfg.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("logfwd: slack request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("logfwd: slack send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("logfwd: slack webhook returned %d", resp.StatusCode)
	}
	return nil
}

// isHighSeverityAction returns true for critical security events.
func isHighSeverityAction(action string) bool {
	switch action {
	case "auth.login_failed", "auth.account_locked",
		"auth.client_cert_rejected", "auth.recover",
		"admin.user_disabled", "admin.role_revoked":
		return true
	}
	return false
}

// isMediumSeverityAction returns true for notable but non-critical events.
func isMediumSeverityAction(action string) bool {
	switch action {
	case "admin.user_created", "admin.role_granted",
		"admin.totp_reset", "auth.password_changed",
		"item.deleted", "folder.deleted":
		return true
	}
	return false
}
