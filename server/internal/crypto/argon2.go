package crypto

import (
	"crypto/subtle"
	"errors"
	"fmt"

	"golang.org/x/crypto/argon2"
)

// Argon2Params is the configurable input to Argon2id. Stored alongside each
// password hash so parameters can be upgraded over time without breaking
// existing users (silent re-hash on next login when params drift).
//
// Default values come from ADR-0004 §4.
type Argon2Params struct {
	// TimeCost is the number of iterations.
	TimeCost uint32 `json:"t"`
	// MemoryCost is in KiB. 65536 = 64 MiB.
	MemoryCost uint32 `json:"m"`
	// Parallelism is the number of threads (lanes).
	Parallelism uint8 `json:"p"`
	// SaltLength is the salt size in bytes (caller can request).
	SaltLength uint32 `json:"s"`
	// KeyLength is the resulting hash length in bytes.
	KeyLength uint32 `json:"k"`
}

// DefaultArgon2Params is the recommended baseline (RFC 9106 second-tier
// recommendation, server-side appropriate). t=3, m=64MiB, p=4, salt=16, key=32.
var DefaultArgon2Params = Argon2Params{
	TimeCost:    3,
	MemoryCost:  64 * 1024,
	Parallelism: 4,
	SaltLength:  16,
	KeyLength:   32,
}

// ErrInvalidArgon2Params is returned when params are out of safe range.
var ErrInvalidArgon2Params = errors.New("crypto: invalid Argon2 params")

// Validate ensures the params are internally consistent and non-degenerate.
func (p Argon2Params) Validate() error {
	if p.TimeCost == 0 {
		return fmt.Errorf("%w: time_cost must be >= 1", ErrInvalidArgon2Params)
	}
	if p.MemoryCost < 8*uint32(p.Parallelism) {
		return fmt.Errorf("%w: memory_cost must be >= 8*parallelism", ErrInvalidArgon2Params)
	}
	if p.Parallelism == 0 {
		return fmt.Errorf("%w: parallelism must be >= 1", ErrInvalidArgon2Params)
	}
	if p.SaltLength < 8 {
		return fmt.Errorf("%w: salt_length must be >= 8", ErrInvalidArgon2Params)
	}
	if p.KeyLength < 16 {
		return fmt.Errorf("%w: key_length must be >= 16", ErrInvalidArgon2Params)
	}
	return nil
}

// HashPassword generates a fresh salt, derives an Argon2id hash with the
// default params, and returns (hash, salt, params). Caller stores all three.
func HashPassword(password string) (hash, salt []byte, params Argon2Params, err error) {
	return HashPasswordWithParams(password, DefaultArgon2Params)
}

// HashPasswordWithParams is HashPassword with caller-supplied params (used by
// tests with reduced cost factors and for future param upgrades).
func HashPasswordWithParams(password string, params Argon2Params) (hash, salt []byte, _ Argon2Params, err error) {
	if err := params.Validate(); err != nil {
		return nil, nil, params, err
	}
	salt, err = RandomBytes(int(params.SaltLength))
	if err != nil {
		return nil, nil, params, err
	}
	hash = argon2.IDKey(
		[]byte(password),
		salt,
		params.TimeCost,
		params.MemoryCost,
		params.Parallelism,
		params.KeyLength,
	)
	return hash, salt, params, nil
}

// VerifyPassword recomputes Argon2id with the stored salt+params and compares
// in constant time against the stored hash. Returns true iff the password is
// correct.
func VerifyPassword(password string, hash, salt []byte, params Argon2Params) bool {
	if len(hash) == 0 || len(salt) == 0 {
		return false
	}
	if err := params.Validate(); err != nil {
		return false
	}
	candidate := argon2.IDKey(
		[]byte(password),
		salt,
		params.TimeCost,
		params.MemoryCost,
		params.Parallelism,
		params.KeyLength,
	)
	return subtle.ConstantTimeCompare(candidate, hash) == 1
}

// DeriveKey is HashPassword's no-salt-generation cousin used by clients to
// re-derive a Key Encryption Key (KEK) from a master password.
//
// The salt and params are presumed to be persisted server-side and fetched
// at login time (see auth-flow.md Senaryo 3).
func DeriveKey(password, salt []byte, params Argon2Params) ([]byte, error) {
	if err := params.Validate(); err != nil {
		return nil, err
	}
	if len(salt) == 0 {
		return nil, fmt.Errorf("%w: empty salt", ErrInvalidArgon2Params)
	}
	return argon2.IDKey(
		password,
		salt,
		params.TimeCost,
		params.MemoryCost,
		params.Parallelism,
		params.KeyLength,
	), nil
}
