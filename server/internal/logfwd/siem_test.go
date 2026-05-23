package logfwd_test

// siem_test.go — PR-SIEM: unit tests for Splunk HEC and Elastic ECS forwarders.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"envanter.app/server/internal/logfwd"
)

// ---------- helpers ----------

func sampleEvent() logfwd.Event {
	actorID := "user-001"
	resType := "item"
	resID := "item-abc"
	details, _ := json.Marshal(map[string]string{"key": "value"})
	return logfwd.Event{
		ID:           "evt-001",
		Action:       "item.create",
		ActorUserID:  &actorID,
		ResourceType: &resType,
		ResourceID:   &resID,
		Details:      details,
		CreatedAt:    time.Now().UTC(),
	}
}

// ---------- ParseSplunkConfig ----------

func TestParseSplunkConfig_Valid(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{
		"url":   "https://splunk.internal:8088/services/collector/event",
		"token": "abc123",
	})
	cfg, err := logfwd.ParseSplunkConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.URL == "" || cfg.Token == "" {
		t.Error("expected non-empty URL and Token")
	}
	if cfg.SourceType == "" {
		t.Error("expected default SourceType to be set")
	}
}

func TestParseSplunkConfig_MissingURL(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"token": "abc123"})
	_, err := logfwd.ParseSplunkConfig(raw)
	if err == nil {
		t.Error("expected error for missing url")
	}
}

func TestParseSplunkConfig_MissingToken(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"url": "https://splunk.internal:8088/services/collector/event"})
	_, err := logfwd.ParseSplunkConfig(raw)
	if err == nil {
		t.Error("expected error for missing token")
	}
}

// ---------- ParseElasticConfig ----------

func TestParseElasticConfig_Valid_APIKey(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{
		"url":     "https://elastic.internal:9200",
		"api_key": "dXNlcjpwYXNz",
	})
	cfg, err := logfwd.ParseElasticConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Index == "" {
		t.Error("expected default index to be set")
	}
}

func TestParseElasticConfig_MissingAuth(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"url": "https://elastic.internal:9200"})
	_, err := logfwd.ParseElasticConfig(raw)
	if err == nil {
		t.Error("expected error for missing auth")
	}
}

// ---------- SplunkForwarder.Send (mock server) ----------

func TestSplunkForwarder_SendSuccess(t *testing.T) {
	received := make(chan []byte, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- body
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"text":"Success","code":0}`))
	}))
	defer srv.Close()

	cfg := logfwd.SplunkConfig{
		URL:        srv.URL + "/services/collector/event",
		Token:      "test-token",
		SourceType: "ironstock:audit",
	}
	f := logfwd.NewSplunkForwarder("cfg-1", cfg)

	if err := f.Send(context.Background(), sampleEvent()); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	select {
	case body := <-received:
		if !strings.Contains(string(body), "item.create") {
			t.Errorf("expected event action in body, got: %s", body)
		}
		if !strings.Contains(string(body), "ironstock") {
			t.Errorf("expected 'ironstock' host in HEC envelope, got: %s", body)
		}
	default:
		t.Error("expected request to be received")
	}
}

// ---------- ElasticForwarder.Send (mock server) ----------

func TestElasticForwarder_SendSuccess(t *testing.T) {
	received := make(chan []byte, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- body
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"took":1,"errors":false,"items":[]}`))
	}))
	defer srv.Close()

	cfg := logfwd.ElasticConfig{
		URL:    srv.URL,
		Index:  "ironstock-test",
		APIKey: "dXNlcjpwYXNz",
	}
	f := logfwd.NewElasticForwarder("cfg-2", cfg)

	if err := f.Send(context.Background(), sampleEvent()); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	select {
	case body := <-received:
		bodyStr := string(body)
		// Bulk format: action line + document line.
		if !strings.Contains(bodyStr, `{"index":{}}`) {
			t.Errorf("expected bulk action line, got: %s", bodyStr)
		}
		if !strings.Contains(bodyStr, "@timestamp") {
			t.Errorf("expected @timestamp in ECS doc, got: %s", bodyStr)
		}
		if !strings.Contains(bodyStr, "ironstock.audit") {
			t.Errorf("expected dataset field, got: %s", bodyStr)
		}
	default:
		t.Error("expected request to be received")
	}
}

// ---------- ParseConfig (integration) ----------

func TestParseConfig_Splunk(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{
		"url": "https://splunk.internal:8088/services/collector/event", "token": "t",
	})
	_, err := logfwd.ParseConfig("splunk", raw)
	if err != nil {
		t.Errorf("ParseConfig splunk: %v", err)
	}
}

func TestParseConfig_Elastic(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"url": "https://elastic.internal:9200", "api_key": "k"})
	_, err := logfwd.ParseConfig("elastic", raw)
	if err != nil {
		t.Errorf("ParseConfig elastic: %v", err)
	}
}
