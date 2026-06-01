package logfwd

// elastic.go — PR-SIEM: Elastic ECS (Elasticsearch) log forwarder.
//
// Sends audit events to Elasticsearch using the Bulk API with ECS field mapping.
// Endpoint: POST https://<host>:<port>/<index>/_bulk
// Auth: ApiKey header OR Basic auth.
//
// ECS field mapping:
//   @timestamp     → ev.CreatedAt (RFC3339)
//   event.action   → ev.Action
//   event.dataset  → "ironstock.audit"
//   user.id        → ev.ActorUserID
//   log.level      → "info"
//   ironstock.*    → extended fields

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ElasticConfig holds parameters for an Elasticsearch target.
type ElasticConfig struct {
	// URL is the Elasticsearch base URL, e.g. https://elastic.internal:9200
	URL string `json:"url"`
	// Index is the target index name (default: "ironstock-audit").
	Index string `json:"index,omitempty"`
	// APIKey is the base64-encoded Elastic API key (id:api_key format).
	// Mutually exclusive with Username/Password.
	APIKey string `json:"api_key,omitempty"`
	// Username / Password for basic auth.
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	// TLSInsecureSkipVerify disables certificate verification (dev only).
	TLSInsecureSkipVerify bool `json:"tls_insecure_skip_verify,omitempty"`
}

// ecsEvent is the ECS-mapped audit event for Elasticsearch.
type ecsEvent struct {
	Timestamp string         `json:"@timestamp"`
	Event     ecsEventFields `json:"event"`
	User      *ecsUser       `json:"user,omitempty"`
	Log       ecsLog         `json:"log"`
	IronStock map[string]any `json:"ironstock,omitempty"`
}

type ecsEventFields struct {
	Action  string `json:"action"`
	Dataset string `json:"dataset"`
	Module  string `json:"module"`
}

type ecsUser struct {
	ID string `json:"id"`
}

type ecsLog struct {
	Level string `json:"level"`
}

// ElasticForwarder sends events to Elasticsearch via the Bulk API.
type ElasticForwarder struct {
	configID string
	cfg      ElasticConfig
	client   *http.Client
	authHdr  string // pre-computed auth header value
	bulkURL  string // pre-computed bulk endpoint URL
}

// NewElasticForwarder creates a new Elastic forwarder.
func NewElasticForwarder(configID string, cfg ElasticConfig) *ElasticForwarder {
	idx := cfg.Index
	if idx == "" {
		idx = "ironstock-audit"
	}

	// Compute auth header once.
	authHdr := ""
	if cfg.APIKey != "" {
		authHdr = "ApiKey " + cfg.APIKey
	} else if cfg.Username != "" {
		creds := base64.StdEncoding.EncodeToString([]byte(cfg.Username + ":" + cfg.Password))
		authHdr = "Basic " + creds
	}

	return &ElasticForwarder{
		configID: configID,
		cfg:      cfg,
		client:   &http.Client{Timeout: 10 * time.Second},
		authHdr:  authHdr,
		bulkURL:  cfg.URL + "/" + idx + "/_bulk",
	}
}

// ConfigID implements Forwarder.
func (f *ElasticForwarder) ConfigID() string { return f.configID }

// Close implements Forwarder.
func (f *ElasticForwarder) Close() error { return nil }

// Send implements Forwarder — delivers one event via Elastic Bulk API with retry.
// The Bulk API requires two newline-separated JSON lines per document:
//
//	{"index": {}}
//	{"@timestamp": ..., ...}
func (f *ElasticForwarder) Send(ctx context.Context, ev Event) error {
	ecs := f.toECS(ev)
	docJSON, err := json.Marshal(ecs)
	if err != nil {
		return fmt.Errorf("elastic: marshal event: %w", err)
	}

	// Bulk format: action line + document line, each terminated by \n.
	var buf bytes.Buffer
	buf.WriteString(`{"index":{}}`)
	buf.WriteByte('\n')
	buf.Write(docJSON)
	buf.WriteByte('\n')

	return retryPost(ctx, f.client, f.bulkURL, f.authHdr,
		"application/x-ndjson", buf.Bytes(), 3)
}

// toECS maps a logfwd.Event to an ECS document.
func (f *ElasticForwarder) toECS(ev Event) ecsEvent {
	doc := ecsEvent{
		Timestamp: ev.CreatedAt.UTC().Format(time.RFC3339Nano),
		Event: ecsEventFields{
			Action:  ev.Action,
			Dataset: "ironstock.audit",
			Module:  "ironstock",
		},
		Log: ecsLog{Level: "info"},
	}

	if ev.ActorUserID != nil && *ev.ActorUserID != "" {
		doc.User = &ecsUser{ID: *ev.ActorUserID}
	}

	// Extended IronStock fields.
	extra := map[string]any{
		"event_id": ev.ID,
	}
	if ev.ResourceType != nil {
		extra["resource_type"] = *ev.ResourceType
	}
	if ev.ResourceID != nil {
		extra["resource_id"] = *ev.ResourceID
	}
	if ev.Details != nil {
		var details map[string]any
		if json.Unmarshal(ev.Details, &details) == nil {
			extra["details"] = details
		}
	}
	doc.IronStock = extra

	return doc
}

// ParseElasticConfig decodes JSONB config into ElasticConfig.
func ParseElasticConfig(raw json.RawMessage) (ElasticConfig, error) {
	var c ElasticConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("logfwd: parse elastic config: %w", err)
	}
	if c.URL == "" {
		return c, fmt.Errorf("logfwd: elastic url is required")
	}
	if c.APIKey == "" && c.Username == "" {
		return c, fmt.Errorf("logfwd: elastic requires api_key or username/password")
	}
	if c.Index == "" {
		c.Index = "ironstock-audit"
	}
	return c, nil
}
