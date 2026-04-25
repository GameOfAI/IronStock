package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func mustKey(t *testing.T) []byte {
	t.Helper()
	k, err := RandomBytes(KeyLength)
	if err != nil {
		t.Fatalf("RandomBytes: %v", err)
	}
	return k
}

func TestNewCipher_BadKeyLength(t *testing.T) {
	for _, badLen := range []int{0, 1, 16, 31, 33, 64} {
		_, err := NewCipher(make([]byte, badLen))
		if !errors.Is(err, ErrInvalidKeyLength) {
			t.Errorf("NewCipher(len=%d) err = %v, want ErrInvalidKeyLength", badLen, err)
		}
	}
}

func TestCipher_RoundTrip(t *testing.T) {
	c, err := NewCipher(mustKey(t))
	if err != nil {
		t.Fatal(err)
	}
	plaintexts := [][]byte{
		[]byte("hello"),
		[]byte(""),
		make([]byte, 1024), // all-zero
		bytes.Repeat([]byte{0xAA}, 65),
	}
	aad := MakeAAD("items", "row-1", "name_enc")
	for i, pt := range plaintexts {
		ct, err := c.Seal(pt, aad)
		if err != nil {
			t.Fatalf("case %d Seal: %v", i, err)
		}
		got, err := c.Open(ct, aad)
		if err != nil {
			t.Fatalf("case %d Open: %v", i, err)
		}
		if !bytes.Equal(got, pt) {
			t.Errorf("case %d: got %q, want %q", i, got, pt)
		}
	}
}

func TestCipher_DifferentNoncesEachCall(t *testing.T) {
	c, err := NewCipher(mustKey(t))
	if err != nil {
		t.Fatal(err)
	}
	pt := []byte("same plaintext")
	aad := MakeAAD("items", "x", "y")
	a, err := c.Seal(pt, aad)
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.Seal(pt, aad)
	if err != nil {
		t.Fatal(err)
	}
	// Two seals of same plaintext with same key+aad must differ (nonce is random).
	if bytes.Equal(a, b) {
		t.Error("two Seal calls produced identical ciphertext (nonce reuse — catastrophic)")
	}
}

func TestCipher_AADTamperingFails(t *testing.T) {
	c, err := NewCipher(mustKey(t))
	if err != nil {
		t.Fatal(err)
	}
	pt := []byte("secret")
	good := MakeAAD("items", "row-a", "name")
	wrong := MakeAAD("items", "row-b", "name") // different row
	ct, err := c.Seal(pt, good)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Open(ct, wrong); err == nil {
		t.Error("Open with wrong AAD succeeded — substitution attack possible")
	}
}

func TestCipher_CrossKeyFails(t *testing.T) {
	c1, _ := NewCipher(mustKey(t))
	c2, _ := NewCipher(mustKey(t))
	aad := MakeAAD("t", "r", "c")
	ct, err := c1.Seal([]byte("data"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c2.Open(ct, aad); err == nil {
		t.Error("Open with wrong key succeeded — KEY ISOLATION BROKEN")
	}
}

func TestCipher_TamperedCiphertextFails(t *testing.T) {
	c, _ := NewCipher(mustKey(t))
	aad := MakeAAD("t", "r", "c")
	ct, err := c.Seal([]byte("data"), aad)
	if err != nil {
		t.Fatal(err)
	}
	// Flip one bit in the ciphertext body (last byte = part of GCM tag).
	tampered := make([]byte, len(ct))
	copy(tampered, ct)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := c.Open(tampered, aad); err == nil {
		t.Error("Open of tampered ciphertext succeeded — AEAD authenticator broken")
	}
}

func TestCipher_OpenAlgorithmMismatch(t *testing.T) {
	c, _ := NewCipher(mustKey(t))
	aad := MakeAAD("t", "r", "c")
	ct, err := c.Seal([]byte("data"), aad)
	if err != nil {
		t.Fatal(err)
	}
	// Replace the algorithm byte with an unknown value.
	bad := make([]byte, len(ct))
	copy(bad, ct)
	bad[1] = 0x99
	_, err = c.Open(bad, aad)
	if !errors.Is(err, ErrAlgorithmMismatch) {
		t.Errorf("err = %v, want ErrAlgorithmMismatch", err)
	}
}
