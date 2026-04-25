package crypto

import (
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

// X25519PublicKeyLen is the length of an X25519 public key in bytes.
const X25519PublicKeyLen = 32

// X25519PrivateKeyLen is the length of an X25519 private key in bytes.
const X25519PrivateKeyLen = 32

// SealedBoxOverhead is the per-message size addition above the plaintext:
// header (2) + ephemeral pub (32) + nonce (12) + GCM tag (16) = 62 bytes.
const SealedBoxOverhead = HeaderLen + X25519PublicKeyLen + AESGCMNonceLen + AESGCMTagLen

// ErrInvalidPublicKey is returned for malformed X25519 public keys.
var ErrInvalidPublicKey = errors.New("crypto: invalid X25519 public key")

// ErrInvalidPrivateKey is returned for malformed X25519 private keys.
var ErrInvalidPrivateKey = errors.New("crypto: invalid X25519 private key")

// GenerateX25519Keypair returns a new (priv, pub) pair, both 32 bytes.
//
// The private key returned is the raw 32-byte scalar suitable for storage
// or for re-creating the same crypto/ecdh.PrivateKey.
func GenerateX25519Keypair() (priv, pub []byte, err error) {
	curve := ecdh.X25519()
	sk, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("crypto: ecdh.GenerateKey: %w", err)
	}
	return sk.Bytes(), sk.PublicKey().Bytes(), nil
}

// SealForRecipient encrypts plaintext anonymously for the X25519 public key
// recipientPub. Anyone holding recipientPub's matching private key can open
// the result; the sender is unauthenticated (no signature). This is the
// classic NaCl "sealed box" pattern, layered on top of our versioned
// blob format.
//
// On-the-wire layout:
//
//	[ Version1 ][ AlgX25519Sealed ][ ephemeralPub:32 ][ nonce:12 ][ aes-gcm body ]
//
// The shared secret is derived as
// HKDF-SHA256(ECDH(eph_priv, recipient_pub), salt=ephemeralPub||recipientPub, info="envanter-sealed-box-v1").
func SealForRecipient(recipientPub, plaintext, aad []byte) ([]byte, error) {
	if len(recipientPub) != X25519PublicKeyLen {
		return nil, fmt.Errorf("%w: got %d bytes, want %d",
			ErrInvalidPublicKey, len(recipientPub), X25519PublicKeyLen)
	}
	curve := ecdh.X25519()

	recipient, err := curve.NewPublicKey(recipientPub)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidPublicKey, err)
	}

	ephSK, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("crypto: ephemeral keygen: %w", err)
	}
	ephPub := ephSK.PublicKey().Bytes()

	shared, err := ephSK.ECDH(recipient)
	if err != nil {
		return nil, fmt.Errorf("crypto: ECDH: %w", err)
	}

	symKey, err := deriveSealKey(shared, ephPub, recipientPub)
	if err != nil {
		return nil, err
	}

	c, err := NewCipher(symKey)
	if err != nil {
		return nil, err
	}

	nonce, err := RandomBytes(AESGCMNonceLen)
	if err != nil {
		return nil, err
	}
	body := c.aead.Seal(nil, nonce, plaintext, aad)

	out := make([]byte, 0, SealedBoxOverhead+len(plaintext))
	out = append(out, Version1, AlgX25519Sealed)
	out = append(out, ephPub...)
	out = append(out, nonce...)
	out = append(out, body...)
	return out, nil
}

// OpenSealed reverses SealForRecipient using the recipient's private key.
//
// recipientPriv must be the same 32-byte scalar produced by
// GenerateX25519Keypair (or equivalent).
func OpenSealed(recipientPriv, blob, aad []byte) ([]byte, error) {
	if len(recipientPriv) != X25519PrivateKeyLen {
		return nil, fmt.Errorf("%w: got %d bytes, want %d",
			ErrInvalidPrivateKey, len(recipientPriv), X25519PrivateKeyLen)
	}
	if len(blob) < SealedBoxOverhead {
		return nil, fmt.Errorf("%w: have %d bytes, need >= %d",
			ErrShortBlob, len(blob), SealedBoxOverhead)
	}
	if blob[0] != Version1 {
		return nil, fmt.Errorf("%w: 0x%02x", ErrUnsupportedVersion, blob[0])
	}
	if blob[1] != AlgX25519Sealed {
		return nil, fmt.Errorf("%w: got 0x%02x, want sealed-box (0x%02x)",
			ErrAlgorithmMismatch, blob[1], AlgX25519Sealed)
	}

	pos := HeaderLen
	ephPub := blob[pos : pos+X25519PublicKeyLen]
	pos += X25519PublicKeyLen
	nonce := blob[pos : pos+AESGCMNonceLen]
	pos += AESGCMNonceLen
	body := blob[pos:]

	curve := ecdh.X25519()
	sk, err := curve.NewPrivateKey(recipientPriv)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidPrivateKey, err)
	}
	eph, err := curve.NewPublicKey(ephPub)
	if err != nil {
		return nil, fmt.Errorf("crypto: ephemeral pub parse: %w", err)
	}
	shared, err := sk.ECDH(eph)
	if err != nil {
		return nil, fmt.Errorf("crypto: ECDH: %w", err)
	}

	recipientPub := sk.PublicKey().Bytes()
	symKey, err := deriveSealKey(shared, ephPub, recipientPub)
	if err != nil {
		return nil, err
	}

	c, err := NewCipher(symKey)
	if err != nil {
		return nil, err
	}
	plaintext, err := c.aead.Open(nil, nonce, body, aad)
	if err != nil {
		return nil, fmt.Errorf("crypto: sealed-box open: %w", err)
	}
	return plaintext, nil
}

// deriveSealKey turns the ECDH shared secret into a 32-byte AES key via
// HKDF-SHA256 with both endpoint pubkeys mixed into the salt.
func deriveSealKey(shared, ephPub, recipientPub []byte) ([]byte, error) {
	salt := make([]byte, 0, len(ephPub)+len(recipientPub))
	salt = append(salt, ephPub...)
	salt = append(salt, recipientPub...)
	r := hkdf.New(sha256New, shared, salt, []byte("envanter-sealed-box-v1"))
	out := make([]byte, KeyLength)
	if _, err := io.ReadFull(r, out); err != nil {
		return nil, fmt.Errorf("crypto: hkdf read: %w", err)
	}
	return out, nil
}
