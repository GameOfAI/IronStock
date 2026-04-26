// Package auth — account lockout policy.
//
// Brute-force resistance: after MaxFailedLoginAttempts wrong-password attempts
// in a row, the user is locked for LockoutDuration. The "wrong TOTP" path
// uses the same counter — we don't separate them, since the goal is to slow
// any attacker without giving them an oracle for which step failed.
//
// Policy (ADR-0004 §10, auth-flow.md §10):
//
//	MaxFailedLoginAttempts = 10
//	LockoutDuration        = 30 * time.Minute
//
// State machine (per-user, columns on `users`):
//
//	failed_login_attempts  int  — counter, reset to 0 on success
//	locked_until           timestamptz — NULL when not locked
//
//	on success: SET failed_login_attempts=0, locked_until=NULL, last_login_at=now()
//	on failure: SET failed_login_attempts = failed_login_attempts + 1
//	             if failed_login_attempts >= MaxFailedLoginAttempts:
//	                 SET locked_until = now() + LockoutDuration,
//	                     failed_login_attempts = 0
//
// Note: we zero the counter when locking out so the user gets a fresh budget
// after the lockout window expires (rather than hitting the wall every retry).
package auth

import "time"

// MaxFailedLoginAttempts is how many wrong-password / wrong-TOTP attempts
// a user gets before being locked.
const MaxFailedLoginAttempts = 10

// LockoutDuration is how long the account stays locked after exceeding
// MaxFailedLoginAttempts.
const LockoutDuration = 30 * time.Minute

// IsLocked reports whether the user's locked_until is in the future.
//
// nil pointer or zero time both mean "not locked". A past time means the
// lockout has already expired and a successful login should clear it.
func IsLocked(lockedUntil *time.Time) bool {
	if lockedUntil == nil {
		return false
	}
	if lockedUntil.IsZero() {
		return false
	}
	return lockedUntil.After(nowFn())
}
