// Package health computes item health scores (0–100).
//
// Rules are heuristic and configurable; the score is an advisory indicator
// shown in the UI and used to surface unhealthy credentials in the admin
// dashboard. A score of 100 means "no known issues"; zero means "critically
// unhealthy". Deductions are capped so the total never goes below 0.
//
// Field values are E2E encrypted and inaccessible to the server — rules only
// examine metadata columns on the items table (expiry, rotation timestamps,
// last_viewed_at, description, tags presence, k8s bindings).
package health

import (
	"time"
)

// ItemMeta contains the metadata columns available for scoring.
// All pointer fields are nullable DB columns; nil means "not set".
type ItemMeta struct {
	ID                   string
	ExpiresAt            *time.Time
	LastRotatedAt        *time.Time
	RotationIntervalDays *int
	Description          string // plaintext (non-secret metadata)
	HasTags              bool   // true if ≥1 tag exists for this item via item_tags
	K8sBindingExists     bool   // true if an item_k8s_bindings row exists
	K8sClusterReachable  bool   // true if the bound cluster passed liveness check
	RelationshipCount    int    // number of edges in item_relationships
}

// Score computes a health score (0–100) for the given item metadata.
// now is injected for testability.
func Score(meta ItemMeta, now time.Time) int {
	score := 100

	// ── Expiry checks ───────────────────────────────────────────────────────
	if meta.ExpiresAt != nil {
		if meta.ExpiresAt.Before(now) {
			// Already expired.
			score -= 25
		} else if meta.ExpiresAt.Before(now.Add(7 * 24 * time.Hour)) {
			// Expiring within 7 days.
			score -= 15
		}
	}

	// ── Rotation age ────────────────────────────────────────────────────────
	if meta.LastRotatedAt != nil {
		age := now.Sub(*meta.LastRotatedAt)
		if age > 90*24*time.Hour {
			score -= 10
		}
	}

	// ── Description missing ─────────────────────────────────────────────────
	if meta.Description == "" {
		score -= 5
	}

	// ── Tags missing ────────────────────────────────────────────────────────
	if !meta.HasTags {
		score -= 5
	}

	// ── Isolated in relationship graph ──────────────────────────────────────
	if meta.RelationshipCount == 0 {
		score -= 5
	}

	// ── K8s binding exists but cluster is unreachable ───────────────────────
	if meta.K8sBindingExists && !meta.K8sClusterReachable {
		score -= 15
	}

	if score < 0 {
		score = 0
	}
	return score
}

// Severity returns a string label for the given health score.
func Severity(score int) string {
	switch {
	case score >= 80:
		return "healthy"
	case score >= 50:
		return "warning"
	default:
		return "critical"
	}
}

// Breakdown describes which rules fired and their deductions.
type Breakdown struct {
	Rule      string `json:"rule"`
	Deduction int    `json:"deduction"`
	Detail    string `json:"detail,omitempty"`
}

// ScoreWithBreakdown returns the total score and per-rule breakdown.
func ScoreWithBreakdown(meta ItemMeta, now time.Time) (int, []Breakdown) {
	score := 100
	var bd []Breakdown

	deduct := func(rule string, pts int, detail string) {
		score -= pts
		bd = append(bd, Breakdown{Rule: rule, Deduction: pts, Detail: detail})
	}

	if meta.ExpiresAt != nil {
		if meta.ExpiresAt.Before(now) {
			deduct("expired", 25, "credential has expired")
		} else if meta.ExpiresAt.Before(now.Add(7 * 24 * time.Hour)) {
			deduct("expiring_soon", 15, "expires within 7 days")
		}
	}

	if meta.LastRotatedAt != nil {
		age := now.Sub(*meta.LastRotatedAt)
		if age > 90*24*time.Hour {
			deduct("rotation_stale", 10, "not rotated in over 90 days")
		}
	}

	if meta.Description == "" {
		deduct("no_description", 5, "description is empty")
	}

	if !meta.HasTags {
		deduct("no_tags", 5, "no tags assigned")
	}

	if meta.RelationshipCount == 0 {
		deduct("isolated", 5, "no relationships in graph")
	}

	if meta.K8sBindingExists && !meta.K8sClusterReachable {
		deduct("k8s_unreachable", 15, "bound Kubernetes cluster is unreachable")
	}

	if score < 0 {
		score = 0
	}
	return score, bd
}
