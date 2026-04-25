package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestNew_ReturnsLogger(t *testing.T) {
	logger := New("info", "json")
	if logger == nil {
		t.Fatal("New returned nil")
	}
}

func TestParseLevel(t *testing.T) {
	cases := map[string]slog.Level{
		"debug":   slog.LevelDebug,
		"DEBUG":   slog.LevelDebug,
		"info":    slog.LevelInfo,
		"warn":    slog.LevelWarn,
		"warning": slog.LevelWarn,
		"error":   slog.LevelError,
		"err":     slog.LevelError,
		"":        slog.LevelInfo, // default
		"foobar":  slog.LevelInfo, // unknown -> default
	}
	for in, want := range cases {
		if got := parseLevel(in); got != want {
			t.Errorf("parseLevel(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestNewWithWriter_WritesJSON(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "json")
	logger.Info("test message", slog.String("key", "value"))

	var record map[string]any
	if err := json.Unmarshal(buf.Bytes(), &record); err != nil {
		t.Fatalf("output is not valid JSON: %v\nout=%s", err, buf.String())
	}
	if record["msg"] != "test message" {
		t.Errorf("msg = %v, want 'test message'", record["msg"])
	}
	if record["key"] != "value" {
		t.Errorf("attr key=value missing: %v", record)
	}
	if record["level"] != "INFO" {
		t.Errorf("level = %v, want INFO", record["level"])
	}
}

func TestNewWithWriter_TextFormat(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "text")
	logger.Info("msg")

	out := buf.String()
	// Text format starts with time= ... level=INFO msg=msg
	if !strings.Contains(out, "level=INFO") {
		t.Errorf("text output missing level=INFO: %s", out)
	}
	if !strings.Contains(out, "msg=msg") {
		t.Errorf("text output missing msg: %s", out)
	}
	// Must NOT be JSON
	if strings.HasPrefix(strings.TrimSpace(out), "{") {
		t.Errorf("text format produced JSON-looking output: %s", out)
	}
}

func TestRedactSecrets_RedactsKnownKeys(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "json")

	logger.Info("login attempt",
		slog.String("username", "alice"),
		slog.String("password", "supersecret123"),
		slog.String("api_token", "ghp_xxx"),
		slog.String("private_key", "-----BEGIN..."),
		slog.String("authorization", "Bearer xyz"),
		slog.String("totp_secret", "JBSWY3DPEHPK3PXP"),
	)

	out := buf.String()

	// Sensitive values must NOT appear in plaintext
	for _, leak := range []string{"supersecret123", "ghp_xxx", "BEGIN", "Bearer xyz", "JBSWY3DPEHPK3PXP"} {
		if strings.Contains(out, leak) {
			t.Errorf("secret leaked into log output: %q\nfull=%s", leak, out)
		}
	}

	// Non-secret value should still appear
	if !strings.Contains(out, "alice") {
		t.Errorf("non-secret value missing: %s", out)
	}

	// Redaction marker should appear at least once
	if !strings.Contains(out, "[REDACTED]") {
		t.Errorf("redaction marker missing: %s", out)
	}
}

func TestRedactSecrets_CaseInsensitive(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "json")

	logger.Info("entry",
		slog.String("Password", "leak1"),
		slog.String("API_TOKEN", "leak2"),
		slog.String("Authorization-Header", "leak3"),
	)

	out := buf.String()
	for _, leak := range []string{"leak1", "leak2", "leak3"} {
		if strings.Contains(out, leak) {
			t.Errorf("case-insensitive redaction failed for: %q\nfull=%s", leak, out)
		}
	}
}

func TestRedactSecrets_LeavesNormalAttrsAlone(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "json")

	logger.Info("entry",
		slog.String("hostname", "db-prod-01"),
		slog.Int("port", 5432),
		slog.String("error", "connection refused"),
	)

	out := buf.String()
	for _, want := range []string{"db-prod-01", "5432", "connection refused"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected attr %q in output: %s", want, out)
		}
	}
}

func TestNew_DebugLevelEnablesSource(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "debug", "json")
	logger.Debug("trace this")

	if !strings.Contains(buf.String(), "source") {
		t.Errorf("debug level should add source attr: %s", buf.String())
	}
}

func TestNew_InfoLevelOmitsSource(t *testing.T) {
	var buf bytes.Buffer
	logger := NewWithWriter(&buf, "info", "json")
	logger.Info("no source")

	if strings.Contains(buf.String(), "\"source\"") {
		t.Errorf("info level should not add source attr by default: %s", buf.String())
	}
}
