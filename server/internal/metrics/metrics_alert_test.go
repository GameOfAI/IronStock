package metrics_test

// metrics_alert_test.go — PR-ALERT: verify new alert metrics are registered.

import (
	"testing"

	"envanter.app/server/internal/metrics"
)

// TestAlertMetricsNotNil verifies that all PR-ALERT gauge/counter vars are non-nil.
func TestAlertMetricsNotNil(t *testing.T) {
	if metrics.CredentialsExpiringTotal == nil {
		t.Error("CredentialsExpiringTotal is nil")
	}
	if metrics.CredentialsExpiredTotal == nil {
		t.Error("CredentialsExpiredTotal is nil")
	}
	if metrics.ItemsUnhealthyTotal == nil {
		t.Error("ItemsUnhealthyTotal is nil")
	}
	if metrics.BreakglassLoginsTotal == nil {
		t.Error("BreakglassLoginsTotal is nil")
	}
	if metrics.IronStockAuthFailuresTotal == nil {
		t.Error("IronStockAuthFailuresTotal is nil")
	}
}

// TestCredentialsExpiringLabels verifies the "7d" and "30d" label values exist.
func TestCredentialsExpiringLabels(t *testing.T) {
	// These should not panic — labels are valid.
	metrics.CredentialsExpiringTotal.WithLabelValues("7d").Set(0)
	metrics.CredentialsExpiringTotal.WithLabelValues("30d").Set(0)
}

// TestItemsUnhealthyLabels verifies severity labels.
func TestItemsUnhealthyLabels(t *testing.T) {
	metrics.ItemsUnhealthyTotal.WithLabelValues("high").Set(0)
	metrics.ItemsUnhealthyTotal.WithLabelValues("medium").Set(0)
}
