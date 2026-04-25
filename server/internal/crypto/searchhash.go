package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"hash"
	"io"
	"strings"

	"golang.org/x/crypto/hkdf"
)

// SearchHashLen is the truncated HMAC output length (128-bit / 16 bytes).
//
// Truncation tradeoff: shorter hashes leak less but can theoretically allow
// collisions. With 128 bits the birthday bound is 2^64 — far above realistic
// dataset sizes for an inventory app.
const SearchHashLen = 16

// ErrInvalidSearchKey is returned when the search key is the wrong size.
var ErrInvalidSearchKey = errors.New("crypto: invalid search key length")

// sha256New is exported as a package-level variable so it can be referenced
// from the sealed-box HKDF call as well, keeping a single SHA-256 constructor.
//
//nolint:gochecknoglobals // package-level hash constructor is idiomatic
var sha256New = sha256.New

// DeriveSearchKey produces a deterministic 32-byte search key from the master
// key. info is mixed into HKDF for domain separation; pass a stable string
// such as "envanter-search-v1" so the search index stays consistent across
// restarts.
//
// The same masterKey + info will always yield the same searchKey, so callers
// should store nothing — just re-derive at startup.
func DeriveSearchKey(masterKey []byte, info string) ([]byte, error) {
	if len(masterKey) != KeyLength {
		return nil, fmt.Errorf("%w: got %d, want %d",
			ErrInvalidKeyLength, len(masterKey), KeyLength)
	}
	r := hkdf.New(sha256New, masterKey, []byte("envanter-search-salt-v1"), []byte(info))
	out := make([]byte, KeyLength)
	if _, err := io.ReadFull(r, out); err != nil {
		return nil, fmt.Errorf("crypto: hkdf read: %w", err)
	}
	return out, nil
}

// SearchHash computes a deterministic 16-byte HMAC-SHA256 prefix of the
// case-folded value, suitable for an indexed equality lookup column.
//
// The same plaintext always produces the same hash, which is the whole point
// — but it leaks frequency information. Acceptable for non-secret metadata
// (item names, hostnames). NEVER use it on secret fields.
func SearchHash(searchKey []byte, value string) ([]byte, error) {
	if len(searchKey) != KeyLength {
		return nil, fmt.Errorf("%w: got %d, want %d",
			ErrInvalidSearchKey, len(searchKey), KeyLength)
	}
	h := hmac.New(sha256New, searchKey)
	if _, err := h.Write([]byte(strings.ToLower(value))); err != nil {
		return nil, fmt.Errorf("crypto: hmac write: %w", err)
	}
	full := h.Sum(nil)
	out := make([]byte, SearchHashLen)
	copy(out, full[:SearchHashLen])
	return out, nil
}

// Compile-time assertion that crypto/sha256 satisfies the hash.Hash interface
// (saves the test file from importing both packages just for the assertion).
var _ func() hash.Hash = sha256New
