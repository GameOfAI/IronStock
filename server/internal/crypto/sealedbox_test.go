package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func TestX25519Keypair_Lengths(t *testing.T) {
	priv, pub, err := GenerateX25519Keypair()
	if err != nil {
		t.Fatal(err)
	}
	if len(priv) != X25519PrivateKeyLen {
		t.Errorf("priv len = %d, want %d", len(priv), X25519PrivateKeyLen)
	}
	if len(pub) != X25519PublicKeyLen {
		t.Errorf("pub len = %d, want %d", len(pub), X25519PublicKeyLen)
	}
}

func TestX25519Keypair_DifferentEachCall(t *testing.T) {
	p1, k1, err := GenerateX25519Keypair()
	if err != nil {
		t.Fatal(err)
	}
	p2, k2, err := GenerateX25519Keypair()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(p1, p2) {
		t.Error("two keypair generations produced same priv")
	}
	if bytes.Equal(k1, k2) {
		t.Error("two keypair generations produced same pub")
	}
}

func TestSealedBox_RoundTrip(t *testing.T) {
	priv, pub, err := GenerateX25519Keypair()
	if err != nil {
		t.Fatal(err)
	}
	plaintext := []byte("e2e-secret-payload")
	aad := MakeAAD("item_shares", "share-id-123", "wrapped_dek")

	sealed, err := SealForRecipient(pub, plaintext, aad)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if len(sealed) < SealedBoxOverhead+len(plaintext) {
		t.Errorf("sealed length = %d, want >= %d", len(sealed), SealedBoxOverhead+len(plaintext))
	}

	got, err := OpenSealed(priv, sealed, aad)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Errorf("got %q, want %q", got, plaintext)
	}
}

func TestSealedBox_WrongRecipientFails(t *testing.T) {
	_, alicePub, _ := GenerateX25519Keypair()
	bobPriv, _, _ := GenerateX25519Keypair()
	aad := MakeAAD("t", "r", "c")

	sealed, err := SealForRecipient(alicePub, []byte("for alice"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenSealed(bobPriv, sealed, aad); err == nil {
		t.Error("Bob opened message addressed to Alice — recipient binding broken")
	}
}

func TestSealedBox_WrongAADFails(t *testing.T) {
	priv, pub, _ := GenerateX25519Keypair()
	good := MakeAAD("item_shares", "share-1", "wrapped_dek")
	wrong := MakeAAD("item_shares", "share-2", "wrapped_dek")

	sealed, err := SealForRecipient(pub, []byte("payload"), good)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenSealed(priv, sealed, wrong); err == nil {
		t.Error("OpenSealed with wrong AAD succeeded")
	}
}

func TestSealedBox_DifferentEphemeralEachCall(t *testing.T) {
	_, pub, _ := GenerateX25519Keypair()
	aad := MakeAAD("t", "r", "c")
	a, _ := SealForRecipient(pub, []byte("same"), aad)
	b, _ := SealForRecipient(pub, []byte("same"), aad)
	if bytes.Equal(a, b) {
		t.Error("two seals produced identical bytes — ephemeral key not random")
	}
}

func TestSealedBox_BadPublicKeyLength(t *testing.T) {
	_, err := SealForRecipient(make([]byte, 16), []byte("data"), nil)
	if !errors.Is(err, ErrInvalidPublicKey) {
		t.Errorf("err = %v, want ErrInvalidPublicKey", err)
	}
}

func TestSealedBox_BadPrivateKeyLength(t *testing.T) {
	_, err := OpenSealed(make([]byte, 16), make([]byte, SealedBoxOverhead+8), nil)
	if !errors.Is(err, ErrInvalidPrivateKey) {
		t.Errorf("err = %v, want ErrInvalidPrivateKey", err)
	}
}

func TestSealedBox_TooShortBlob(t *testing.T) {
	priv, _, _ := GenerateX25519Keypair()
	_, err := OpenSealed(priv, []byte("short"), nil)
	if !errors.Is(err, ErrShortBlob) {
		t.Errorf("err = %v, want ErrShortBlob", err)
	}
}

func TestSealedBox_AlgorithmByteValidated(t *testing.T) {
	priv, pub, _ := GenerateX25519Keypair()
	aad := MakeAAD("t", "r", "c")
	sealed, err := SealForRecipient(pub, []byte("data"), aad)
	if err != nil {
		t.Fatal(err)
	}
	bad := make([]byte, len(sealed))
	copy(bad, sealed)
	bad[1] = AlgAESGCM // wrong algorithm for sealed-box
	_, err = OpenSealed(priv, bad, aad)
	if !errors.Is(err, ErrAlgorithmMismatch) {
		t.Errorf("err = %v, want ErrAlgorithmMismatch", err)
	}
}
