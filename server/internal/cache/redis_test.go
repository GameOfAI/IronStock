package cache_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"envanter.app/server/internal/cache"
)

// TestNewNilOnEmptyURL verifies that New returns (nil, nil) when no URL is
// provided — callers must be able to treat nil as "no Redis; use in-memory".
func TestNewNilOnEmptyURL(t *testing.T) {
	c, err := cache.New("", "", slog.Default())
	if err != nil {
		t.Fatalf("expected nil error for empty URL, got %v", err)
	}
	if c != nil {
		t.Fatal("expected nil client for empty URL")
	}
}

// TestNewBadURL verifies that New returns an error for an unparseable URL.
func TestNewBadURL(t *testing.T) {
	_, err := cache.New("not://a valid redis url %%", "", slog.Default())
	if err == nil {
		t.Fatal("expected an error for invalid URL, got nil")
	}
}

// TestCircuitBreakerConstants sanity-checks the exported thresholds so that
// config changes are caught early.
func TestCircuitBreakerConstants(t *testing.T) {
	if cache.RedisErrThreshold <= 0 {
		t.Errorf("RedisErrThreshold must be positive, got %d", cache.RedisErrThreshold)
	}
	if cache.CircuitOpenDuration <= 0 {
		t.Error("CircuitOpenDuration must be positive")
	}
}

// TestIntegration runs against a real Redis only when REDIS_TEST_URL is set.
// CI skips this test unless the redis service is available.
func TestIntegration(t *testing.T) {
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set — skipping integration test")
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	c, err := cache.New(url, "", logger)
	if err != nil {
		t.Fatalf("cache.New: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx := context.Background()

	// Ping
	if err := c.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	// SetEX + GetDel round-trip
	key := "test:cache:key"
	if err := c.SetEX(ctx, key, "hello", 5); err != nil {
		t.Fatalf("SetEX: %v", err)
	}
	val, err := c.GetDel(ctx, key)
	if err != nil {
		t.Fatalf("GetDel: %v", err)
	}
	if val != "hello" {
		t.Errorf("expected %q, got %q", "hello", val)
	}

	// Second GetDel must return redis.Nil (key already deleted)
	_, err = c.GetDel(ctx, key)
	if err == nil {
		t.Error("expected error for missing key, got nil")
	}
}
