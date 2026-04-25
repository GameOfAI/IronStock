package crypto

import (
	"crypto/rand"
	"errors"
	"fmt"
)

// Versioned blob layout (ADR-0004 §3):
//
//	┌────────┬────────┬────────┬─────────────────┬────────────┐
//	│version │ alg_id │ nonce  │   ciphertext    │  auth_tag  │
//	│  1B    │  1B    │  N B   │   M bytes       │   16B      │
//	└────────┴────────┴────────┴─────────────────┴────────────┘
//
// For AES-256-GCM: nonce is 12B, auth_tag is 16B (appended to ciphertext by
// the Go AEAD interface).
const (
	// Version1 is the first (and currently only) blob format version.
	Version1 byte = 0x01

	// AlgAESGCM identifies AES-256-GCM as the algorithm.
	AlgAESGCM byte = 0x01
	// AlgX25519Sealed identifies the X25519 sealed-box wrapping format.
	AlgX25519Sealed byte = 0x02

	// AESGCMNonceLen is the nonce length for AES-GCM (12 bytes / 96 bits).
	AESGCMNonceLen = 12
	// AESGCMTagLen is the GCM authentication tag length (128 bits).
	AESGCMTagLen = 16
	// KeyLength is the symmetric key length used everywhere (32B / 256-bit).
	KeyLength = 32

	// HeaderLen is version + alg_id (the fixed prefix before the nonce).
	HeaderLen = 2
)

// ErrShortBlob is returned by Unpack when the input is too short to contain
// the version+alg+nonce header.
var ErrShortBlob = errors.New("crypto: blob too short")

// ErrUnsupportedVersion is returned when the version byte is unknown.
var ErrUnsupportedVersion = errors.New("crypto: unsupported blob version")

// ErrUnsupportedAlg is returned when the algorithm byte is unknown.
var ErrUnsupportedAlg = errors.New("crypto: unsupported algorithm")

// Blob is a parsed versioned ciphertext.
type Blob struct {
	Version byte
	AlgID   byte
	Nonce   []byte
	// Body is ciphertext concatenated with the auth tag (per Go AEAD layout).
	Body []byte
}

// Pack serializes a Blob into its on-the-wire / on-disk representation.
func Pack(b Blob) []byte {
	out := make([]byte, 0, HeaderLen+len(b.Nonce)+len(b.Body))
	out = append(out, b.Version, b.AlgID)
	out = append(out, b.Nonce...)
	out = append(out, b.Body...)
	return out
}

// Unpack parses a blob, validating version/algorithm and extracting the nonce
// of the requested length.
func Unpack(data []byte, nonceLen int) (Blob, error) {
	if len(data) < HeaderLen+nonceLen {
		return Blob{}, fmt.Errorf("%w: have %d bytes, need >= %d",
			ErrShortBlob, len(data), HeaderLen+nonceLen)
	}
	b := Blob{
		Version: data[0],
		AlgID:   data[1],
	}
	if b.Version != Version1 {
		return Blob{}, fmt.Errorf("%w: 0x%02x", ErrUnsupportedVersion, b.Version)
	}
	b.Nonce = make([]byte, nonceLen)
	copy(b.Nonce, data[HeaderLen:HeaderLen+nonceLen])
	b.Body = make([]byte, len(data)-HeaderLen-nonceLen)
	copy(b.Body, data[HeaderLen+nonceLen:])
	return b, nil
}

// MakeAAD builds the canonical AAD string used to bind a ciphertext to its
// row+column identity. Format: "<table>:<row_id>:<column>".
//
// This prevents cross-row substitution attacks: a ciphertext encrypted with
// AAD "items:abc:name_enc" cannot be successfully decrypted as
// "items:def:name_enc" even with the same key.
func MakeAAD(table, rowID, column string) []byte {
	return []byte(table + ":" + rowID + ":" + column)
}

// RandomBytes returns n cryptographically secure random bytes.
func RandomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("crypto: read random: %w", err)
	}
	return b, nil
}
