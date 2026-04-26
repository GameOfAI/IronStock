package auth

import (
	"testing"
	"time"
)

func TestIsLocked_NilPointer(t *testing.T) {
	if IsLocked(nil) {
		t.Error("IsLocked(nil) = true, want false")
	}
}

func TestIsLocked_ZeroTime(t *testing.T) {
	var zero time.Time
	if IsLocked(&zero) {
		t.Error("IsLocked(zero) = true, want false")
	}
}

func TestIsLocked_PastTime(t *testing.T) {
	past := time.Now().Add(-1 * time.Hour)
	if IsLocked(&past) {
		t.Error("IsLocked(past) = true, want false")
	}
}

func TestIsLocked_FutureTime(t *testing.T) {
	future := time.Now().Add(1 * time.Hour)
	if !IsLocked(&future) {
		t.Error("IsLocked(future) = false, want true")
	}
}

func TestIsLocked_UsesNowFn(t *testing.T) {
	// Pin nowFn to a known instant; lockout time is just after.
	frozen := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)
	prev := nowFn
	nowFn = func() time.Time { return frozen }
	defer func() { nowFn = prev }()

	justAfter := frozen.Add(1 * time.Second)
	if !IsLocked(&justAfter) {
		t.Error("IsLocked(now+1s) = false")
	}
	justBefore := frozen.Add(-1 * time.Second)
	if IsLocked(&justBefore) {
		t.Error("IsLocked(now-1s) = true")
	}
}

func TestLockoutPolicyConstants(t *testing.T) {
	// These are policy decisions (auth-flow.md §"Rate limit"). Pin them so
	// accidental changes break a test.
	if MaxFailedLoginAttempts != 10 {
		t.Errorf("MaxFailedLoginAttempts = %d, want 10", MaxFailedLoginAttempts)
	}
	if LockoutDuration != 30*time.Minute {
		t.Errorf("LockoutDuration = %v, want 30m", LockoutDuration)
	}
}
