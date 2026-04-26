package auth

import (
	"testing"
	"time"
)

func TestSessionRow_IsActive(t *testing.T) {
	now := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)
	revoked := now.Add(-1 * time.Hour)
	reason := "logout"

	cases := []struct {
		name string
		row  SessionRow
		want bool
	}{
		{
			name: "active future expiry",
			row:  SessionRow{ExpiresAt: now.Add(1 * time.Hour)},
			want: true,
		},
		{
			name: "expired",
			row:  SessionRow{ExpiresAt: now.Add(-1 * time.Hour)},
			want: false,
		},
		{
			name: "revoked even if not expired",
			row: SessionRow{
				ExpiresAt:    now.Add(1 * time.Hour),
				RevokedAt:    &revoked,
				RevokeReason: &reason,
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.row.IsActive(now); got != tc.want {
				t.Errorf("IsActive() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestValidRevokeReason(t *testing.T) {
	good := []string{
		RevokeReasonLogout,
		RevokeReasonLogoutAll,
		RevokeReasonRotation,
		RevokeReasonAdmin,
		RevokeReasonExpired,
		RevokeReasonRecovery,
		RevokeReasonReuseDetected,
	}
	for _, r := range good {
		if !validRevokeReason(r) {
			t.Errorf("validRevokeReason(%q) = false", r)
		}
	}
	if validRevokeReason("hack") {
		t.Error("validRevokeReason(\"hack\") = true")
	}
	if validRevokeReason("") {
		t.Error("validRevokeReason(\"\") = true")
	}
}

func TestNullableHelpers(t *testing.T) {
	if nullableString("") != nil {
		t.Error("nullableString(\"\") != nil")
	}
	if nullableString("x") == nil {
		t.Error("nullableString(\"x\") == nil")
	}
	// nullableIP needs an netip.Addr — covered indirectly by integration tests.
}
