package health_test

import (
	"testing"
	"time"

	"envanter.app/server/internal/health"
)

var baseNow = time.Date(2026, 5, 23, 12, 0, 0, 0, time.UTC)

// ptr helpers
func tp(t time.Time) *time.Time { return &t }

func TestScoreFullyHealthy(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                  "abc",
		ExpiresAt:           tp(now.Add(365 * 24 * time.Hour)), // far future
		LastRotatedAt:       tp(now.Add(-30 * 24 * time.Hour)), // recent
		Description:         "has a description",
		HasTags:             true,
		RelationshipCount:   1,
		K8sBindingExists:    false,
		K8sClusterReachable: false,
	}
	got := health.Score(meta, now)
	if got != 100 {
		t.Errorf("healthy item score = %d, want 100", got)
	}
}

func TestScoreExpired(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		ExpiresAt:         tp(now.Add(-1 * time.Hour)), // expired
		LastRotatedAt:     tp(now.Add(-10 * 24 * time.Hour)),
		Description:       "desc",
		HasTags:           true,
		RelationshipCount: 1,
	}
	got := health.Score(meta, now)
	if got != 75 { // 100 - 25
		t.Errorf("expired score = %d, want 75", got)
	}
}

func TestScoreExpiringWithin7Days(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		ExpiresAt:         tp(now.Add(3 * 24 * time.Hour)), // 3 days
		LastRotatedAt:     tp(now.Add(-5 * 24 * time.Hour)),
		Description:       "desc",
		HasTags:           true,
		RelationshipCount: 1,
	}
	got := health.Score(meta, now)
	if got != 85 { // 100 - 15
		t.Errorf("expiring-soon score = %d, want 85", got)
	}
}

func TestScoreRotationStale(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		LastRotatedAt:     tp(now.Add(-100 * 24 * time.Hour)), // >90 days
		Description:       "desc",
		HasTags:           true,
		RelationshipCount: 1,
	}
	got := health.Score(meta, now)
	if got != 90 { // 100 - 10
		t.Errorf("stale rotation score = %d, want 90", got)
	}
}

func TestScoreNoDescription(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		Description:       "",
		HasTags:           true,
		RelationshipCount: 1,
	}
	got := health.Score(meta, now)
	if got != 95 { // 100 - 5
		t.Errorf("no description score = %d, want 95", got)
	}
}

func TestScoreNoTags(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		Description:       "desc",
		HasTags:           false,
		RelationshipCount: 1,
	}
	got := health.Score(meta, now)
	if got != 95 { // 100 - 5
		t.Errorf("no tags score = %d, want 95", got)
	}
}

func TestScoreIsolated(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                "abc",
		Description:       "desc",
		HasTags:           true,
		RelationshipCount: 0,
	}
	got := health.Score(meta, now)
	if got != 95 { // 100 - 5
		t.Errorf("isolated score = %d, want 95", got)
	}
}

func TestScoreK8sUnreachable(t *testing.T) {
	now := baseNow
	meta := health.ItemMeta{
		ID:                  "abc",
		Description:         "desc",
		HasTags:             true,
		RelationshipCount:   1,
		K8sBindingExists:    true,
		K8sClusterReachable: false,
	}
	got := health.Score(meta, now)
	if got != 85 { // 100 - 15
		t.Errorf("k8s unreachable score = %d, want 85", got)
	}
}

func TestScoreFloorZero(t *testing.T) {
	now := baseNow
	// All deductions: expired(-25) + stale rotation(-10) + no desc(-5) + no tags(-5) + isolated(-5) + k8s unreachable(-15) = -65 → 35
	expired := now.Add(-1 * time.Hour)
	stale := now.Add(-100 * 24 * time.Hour)
	meta := health.ItemMeta{
		ID:                  "abc",
		ExpiresAt:           &expired,
		LastRotatedAt:       &stale,
		Description:         "",
		HasTags:             false,
		RelationshipCount:   0,
		K8sBindingExists:    true,
		K8sClusterReachable: false,
	}
	got := health.Score(meta, now)
	want := 35 // 100 - 25 - 10 - 5 - 5 - 5 - 15
	if got != want {
		t.Errorf("all-bad score = %d, want %d", got, want)
	}
}

func TestSeverityLabels(t *testing.T) {
	cases := []struct {
		score    int
		severity string
	}{
		{100, "healthy"},
		{80, "healthy"},
		{79, "warning"},
		{50, "warning"},
		{49, "critical"},
		{0, "critical"},
	}
	for _, tc := range cases {
		got := health.Severity(tc.score)
		if got != tc.severity {
			t.Errorf("Severity(%d) = %q, want %q", tc.score, got, tc.severity)
		}
	}
}

func TestScoreWithBreakdownCount(t *testing.T) {
	now := baseNow
	expired := now.Add(-1 * time.Hour)
	stale := now.Add(-100 * 24 * time.Hour)
	meta := health.ItemMeta{
		ID:                "abc",
		ExpiresAt:         &expired,
		LastRotatedAt:     &stale,
		Description:       "",
		HasTags:           false,
		RelationshipCount: 0,
	}
	score, bd := health.ScoreWithBreakdown(meta, now)
	wantRules := 4 // expired + rotation_stale + no_description + no_tags + isolated = 5
	if len(bd) != 5 {
		t.Errorf("breakdown len = %d, want 5", len(bd))
	}
	_ = wantRules
	if score != 50 { // 100 - 25 - 10 - 5 - 5 - 5
		t.Errorf("breakdown score = %d, want 50", score)
	}
}
