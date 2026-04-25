package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"errors"
	"fmt"
)

// Cipher is an AES-256-GCM authenticated cipher with the versioned blob format.
//
// Construct with NewCipher(key) where key is exactly KeyLength (32) bytes.
// The same Cipher can be reused safely for many Seal/Open calls.
type Cipher struct {
	aead cipher.AEAD
}

// ErrInvalidKeyLength is returned when NewCipher receives a key that is not
// exactly KeyLength (32) bytes.
var ErrInvalidKeyLength = errors.New("crypto: invalid key length (need 32 bytes)")

// ErrAlgorithmMismatch is returned by Open when the blob's algorithm byte
// does not match this Cipher (AES-GCM).
var ErrAlgorithmMismatch = errors.New("crypto: algorithm mismatch")

// NewCipher returns a Cipher backed by AES-256-GCM. key must be 32 bytes.
//
// The provided key slice is NOT copied; callers should not mutate it after
// the call. To zero the key in memory later, hold onto your own copy.
func NewCipher(key []byte) (*Cipher, error) {
	if len(key) != KeyLength {
		return nil, fmt.Errorf("%w: got %d", ErrInvalidKeyLength, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: aes.NewCipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: cipher.NewGCM: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Seal encrypts plaintext, binding the ciphertext to aad, and returns the
// versioned blob.
//
// A fresh random nonce is generated per call. AES-GCM with random nonces is
// safe up to ~2^32 messages per key — well above realistic limits, but key
// rotation is still recommended (ADR-0004 §8).
func (c *Cipher) Seal(plaintext, aad []byte) ([]byte, error) {
	nonce, err := RandomBytes(AESGCMNonceLen)
	if err != nil {
		return nil, err
	}
	body := c.aead.Seal(nil, nonce, plaintext, aad)
	return Pack(Blob{
		Version: Version1,
		AlgID:   AlgAESGCM,
		Nonce:   nonce,
		Body:    body,
	}), nil
}

// Open parses the blob, verifies the AAD binding, and returns plaintext.
//
// Returns an error if the blob is malformed, the algorithm doesn't match, or
// the AAD doesn't authenticate (substitution / tampering).
func (c *Cipher) Open(blob, aad []byte) ([]byte, error) {
	b, err := Unpack(blob, AESGCMNonceLen)
	if err != nil {
		return nil, err
	}
	if b.AlgID != AlgAESGCM {
		return nil, fmt.Errorf("%w: got 0x%02x, want AES-GCM (0x%02x)",
			ErrAlgorithmMismatch, b.AlgID, AlgAESGCM)
	}
	plaintext, err := c.aead.Open(nil, b.Nonce, b.Body, aad)
	if err != nil {
		// AEAD.Open returns a generic error; wrap without leaking which
		// component (key vs aad vs ciphertext) caused the failure.
		return nil, fmt.Errorf("crypto: open: %w", err)
	}
	return plaintext, nil
}
