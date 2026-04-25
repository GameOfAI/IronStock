package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func TestPackUnpack_RoundTrip(t *testing.T) {
	original := Blob{
		Version: Version1,
		AlgID:   AlgAESGCM,
		Nonce:   []byte("123456789012"),
		Body:    []byte("hello world ciphertext+tag"),
	}
	packed := Pack(original)
	unpacked, err := Unpack(packed, AESGCMNonceLen)
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if unpacked.Version != original.Version {
		t.Errorf("Version = 0x%02x, want 0x%02x", unpacked.Version, original.Version)
	}
	if unpacked.AlgID != original.AlgID {
		t.Errorf("AlgID = 0x%02x, want 0x%02x", unpacked.AlgID, original.AlgID)
	}
	if !bytes.Equal(unpacked.Nonce, original.Nonce) {
		t.Errorf("Nonce mismatch: %x vs %x", unpacked.Nonce, original.Nonce)
	}
	if !bytes.Equal(unpacked.Body, original.Body) {
		t.Errorf("Body mismatch: %x vs %x", unpacked.Body, original.Body)
	}
}

func TestUnpack_TooShort(t *testing.T) {
	cases := [][]byte{
		nil,
		{},
		{Version1},                     // missing alg + nonce
		{Version1, AlgAESGCM},          // missing nonce
		{Version1, AlgAESGCM, 1, 2, 3}, // partial nonce
	}
	for _, data := range cases {
		_, err := Unpack(data, AESGCMNonceLen)
		if !errors.Is(err, ErrShortBlob) {
			t.Errorf("Unpack(%x): err = %v, want ErrShortBlob", data, err)
		}
	}
}

func TestUnpack_UnsupportedVersion(t *testing.T) {
	data := append([]byte{0x99, AlgAESGCM}, make([]byte, AESGCMNonceLen+8)...)
	_, err := Unpack(data, AESGCMNonceLen)
	if !errors.Is(err, ErrUnsupportedVersion) {
		t.Errorf("err = %v, want ErrUnsupportedVersion", err)
	}
}

func TestMakeAAD_DistinctRowsDifferentAAD(t *testing.T) {
	a := MakeAAD("items", "row-a", "name_enc")
	b := MakeAAD("items", "row-b", "name_enc")
	if bytes.Equal(a, b) {
		t.Error("AAD identical for different rows")
	}
	c := MakeAAD("items", "row-a", "password_enc")
	if bytes.Equal(a, c) {
		t.Error("AAD identical for different columns")
	}
}

func TestRandomBytes_Length(t *testing.T) {
	for _, n := range []int{1, 16, 32, 64} {
		b, err := RandomBytes(n)
		if err != nil {
			t.Fatalf("RandomBytes(%d): %v", n, err)
		}
		if len(b) != n {
			t.Errorf("RandomBytes(%d) returned %d bytes", n, len(b))
		}
	}
}

func TestRandomBytes_NotPredictable(t *testing.T) {
	a, err := RandomBytes(32)
	if err != nil {
		t.Fatal(err)
	}
	b, err := RandomBytes(32)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, b) {
		t.Error("two RandomBytes(32) calls returned identical bytes (1 in 2^256 chance — almost certainly broken)")
	}
}
