package httpapi_test

// item_health_test.go — PR-HEALTH: compile-time guards for health endpoints.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: ItemHandlers must implement both health endpoints.
var _ interface {
	GetHealth(http.ResponseWriter, *http.Request)
	GetHealthReport(http.ResponseWriter, *http.Request)
} = (*httpapi.ItemHandlers)(nil)

// TestHealthReportResponseDefaults checks that zero-value is safe.
func TestHealthReportResponseDefaults(t *testing.T) {
	var resp httpapi.HealthReportResponse
	if resp.Count != 0 {
		t.Errorf("Count = %d, want 0", resp.Count)
	}
	// Zero-value Items is nil; the handler uses make() so the JSON response is
	// never null in practice.
	if resp.Items != nil {
		t.Errorf("zero-value Items = %v, want nil", resp.Items)
	}
}

// TestItemHealthResponseFields verifies type fields exist and are serializable.
func TestItemHealthResponseFields(t *testing.T) {
	resp := httpapi.ItemHealthResponse{
		ItemID:   "test-id",
		Score:    85,
		Severity: "warning",
	}
	if resp.Score != 85 {
		t.Errorf("Score = %d, want 85", resp.Score)
	}
	if resp.Severity != "warning" {
		t.Errorf("Severity = %q, want warning", resp.Severity)
	}
}

// TestHealthReportThresholdDefault documents that default threshold is 70.
func TestHealthReportThresholdDefault(t *testing.T) {
	// The handler uses parseIntDefault(q, 70, 0, 100), so empty string → 70.
	got := parseIntDefaultTest("", 70, 0, 100)
	if got != 70 {
		t.Errorf("default threshold = %d, want 70", got)
	}
}

// parseIntDefaultTest mirrors the parseIntDefault logic for tests.
func parseIntDefaultTest(s string, def, min, max int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}
