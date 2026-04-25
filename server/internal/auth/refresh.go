package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"envanter.app/server/internal/crypto"
)

// RefreshTokenLifetime is how long a refresh token stays valid before
// requiring re-authentication. ADR-0004 / auth-flow.md §3.
const RefreshTokenLifetime = 7 * 24 * time.Hour

// RefreshTokenLength is the size of the random refresh token in bytes
// (256 bits, hex-encoded becomes 64 chars).
const RefreshTokenLength = 32

// Refresh holds a freshly minted refresh token alongside the values to
// persist into the sessions table.
type Refresh struct {
	// Token is the hex-encoded plaintext returned to the client. NEVER
	// logged or stored server-side beyond the synchronous response write.
	Token string
	// Hash is SHA-256(token) — what goes into sessions.refresh_token_hash.
	Hash []byte
	// ExpiresAt is the absolute expiry for sessions.expires_at.
	ExpiresAt time.Time
}

// GenerateRefresh mints a new refresh token + its SHA-256 hash + expiry.
func GenerateRefresh() (Refresh, error) {
	raw, err := crypto.RandomBytes(RefreshTokenLength)
	if err != nil {
		return Refresh{}, fmt.Errorf("auth: random for refresh: %w", err)
	}
	token := hex.EncodeToString(raw)
	hash := HashRefresh(token)
	return Refresh{
		Token:     token,
		Hash:      hash,
		ExpiresAt: nowFn().Add(RefreshTokenLifetime),
	}, nil
}

// HashRefresh hashes a plaintext refresh token. SHA-256 is fine here because
// the token is high-entropy (256 random bits) — pre-image attack on a single
// hash takes 2^256 work.
func HashRefresh(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}
