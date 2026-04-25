package auth

import (
	"encoding/hex"
	"fmt"

	"envanter.app/server/internal/crypto"
)

// RecoveryCodeLength is the byte size of one code's random source. 8 bytes
// hex-encoded → 16 hex chars, displayed as XXXX-XXXX-XXXX-XXXX (4×4 groups
// in the UI). 64-bit search space is fine because:
//   - Argon2id makes brute-force expensive (~100ms per try).
//   - Single-use: each code disappears from the active pool on first use.
//   - Per-user: an attacker has 10 codes to try, then the user re-enrolls.
const RecoveryCodeLength = 8

// GenerateRecoveryCodes mints n recovery codes:
//   - plain[i] : hex string returned to the user ONCE.
//   - hash[i]  : Argon2id hash to persist in recovery_codes.code_hash.
//
// Caller must store hashes in a single transaction (auth_totp.go does this).
// plain values must NEVER be persisted server-side or logged.
func GenerateRecoveryCodes(n int) (plain []string, hash [][]byte, err error) {
	if n <= 0 {
		return nil, nil, fmt.Errorf("auth: recovery code count must be > 0, got %d", n)
	}
	plain = make([]string, n)
	hash = make([][]byte, n)
	for i := 0; i < n; i++ {
		raw, err := crypto.RandomBytes(RecoveryCodeLength)
		if err != nil {
			return nil, nil, fmt.Errorf("auth: random for recovery: %w", err)
		}
		plain[i] = hex.EncodeToString(raw)
		// Use the same Argon2 settings as passwords; recovery codes are
		// rarely-used so the cost is acceptable.
		h, salt, params, err := crypto.HashPassword(plain[i])
		if err != nil {
			return nil, nil, fmt.Errorf("auth: hash recovery code: %w", err)
		}
		// Store salt + params alongside hash. We pack them as
		// salt(16) || hash(32) since the params are constant
		// (DefaultArgon2Params); future code-versioning can prefix
		// a version byte if params change.
		_ = params
		out := make([]byte, 0, len(salt)+len(h))
		out = append(out, salt...)
		out = append(out, h...)
		hash[i] = out
	}
	return plain, hash, nil
}

// VerifyRecoveryCode checks code against a stored salt||hash blob produced by
// GenerateRecoveryCodes. Returns true iff the code matches.
//
// The blob layout is:  salt[0:saltLen]  || hash[saltLen:]
// We use DefaultArgon2Params; a versioned byte will be added if/when the
// scheme evolves (PR-6 task).
func VerifyRecoveryCode(code string, blob []byte) bool {
	const saltLen = 16
	if len(blob) <= saltLen {
		return false
	}
	salt := blob[:saltLen]
	storedHash := blob[saltLen:]
	return crypto.VerifyPassword(code, storedHash, salt, crypto.DefaultArgon2Params)
}
