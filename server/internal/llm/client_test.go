package llm_test

import (
	"errors"
	"testing"

	"envanter.app/server/internal/llm"
)

func TestNewErrNotConfigured(t *testing.T) {
	_, err := llm.New("", "key", "", "")
	if !errors.Is(err, llm.ErrNotConfigured) {
		t.Errorf("empty provider: err = %v, want ErrNotConfigured", err)
	}
}

func TestNewUnknownProvider(t *testing.T) {
	_, err := llm.New("bedrock", "key", "", "")
	if err == nil {
		t.Error("unknown provider: expected error, got nil")
	}
}

func TestNewAnthropicDefaults(t *testing.T) {
	c, err := llm.New("anthropic", "sk-test", "", "")
	if err != nil {
		t.Fatalf("anthropic new: %v", err)
	}
	if c == nil {
		t.Fatal("client is nil")
	}
}

func TestNewOpenAIDefaults(t *testing.T) {
	c, err := llm.New("openai", "sk-test", "", "")
	if err != nil {
		t.Fatalf("openai new: %v", err)
	}
	if c == nil {
		t.Fatal("client is nil")
	}
}

func TestParseResponseTagsOnly(t *testing.T) {
	// parseResponse is not exported; verify via SuggestForItem indirectly by
	// testing the New constructor and ErrNotConfigured path (unit coverage).
	// Full round-trip tests would require a mock HTTP server.
	_, err := llm.New("anthropic", "test-key", "http://localhost:9999", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// We don't actually call SuggestForItem (would need a live server) — the
	// constructor and error paths are tested above.
}

func TestNewOpenAICustomBaseURL(t *testing.T) {
	c, err := llm.New("openai", "", "http://localhost:11434/v1", "llama3")
	if err != nil {
		t.Fatalf("ollama-style config: %v", err)
	}
	if c == nil {
		t.Fatal("client is nil")
	}
}
