package crypto

import (
	"bytes"
	"testing"
)

func TestGenerateDEK_LengthAndUniqueness(t *testing.T) {
	a, err := GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != KeyLength {
		t.Errorf("len = %d, want %d", len(a), KeyLength)
	}
	b, err := GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, b) {
		t.Error("two GenerateDEK calls returned identical bytes")
	}
}

func TestEnvelope_FullFlow(t *testing.T) {
	masterKey, err := RandomBytes(KeyLength)
	if err != nil {
		t.Fatal(err)
	}
	master, err := NewCipher(masterKey)
	if err != nil {
		t.Fatal(err)
	}

	itemID := "11111111-2222-3333-4444-555555555555"
	plaintext := []byte("db.prod.envanter.local")
	nameAAD := MakeAAD("items", itemID, "name_enc")
	dekAAD := MakeAAD("items", itemID, "dek")

	// 1. Generate DEK
	dek, err := GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	dekCipher, err := NewCipher(dek)
	if err != nil {
		t.Fatal(err)
	}

	// 2. Encrypt data with DEK
	dataBlob, err := dekCipher.Seal(plaintext, nameAAD)
	if err != nil {
		t.Fatal(err)
	}

	// 3. Wrap DEK with master
	wrappedDEK, err := master.Seal(dek, dekAAD)
	if err != nil {
		t.Fatal(err)
	}

	// --- "Persisted to DB" — now read back ---

	// 4. Unwrap DEK
	gotDEK, err := master.Open(wrappedDEK, dekAAD)
	if err != nil {
		t.Fatalf("Unwrap DEK: %v", err)
	}
	if !bytes.Equal(gotDEK, dek) {
		t.Error("unwrapped DEK differs from original")
	}
	gotCipher, err := NewCipher(gotDEK)
	if err != nil {
		t.Fatal(err)
	}

	// 5. Decrypt data
	gotPlain, err := gotCipher.Open(dataBlob, nameAAD)
	if err != nil {
		t.Fatalf("Open data: %v", err)
	}
	if !bytes.Equal(gotPlain, plaintext) {
		t.Errorf("plaintext = %q, want %q", gotPlain, plaintext)
	}
}

func TestEnvelope_WrongRowAADFails(t *testing.T) {
	masterKey, _ := RandomBytes(KeyLength)
	master, _ := NewCipher(masterKey)

	dek, _ := GenerateDEK()
	rowA := MakeAAD("items", "row-a", "dek")
	rowB := MakeAAD("items", "row-b", "dek") // different row

	wrapped, err := master.Seal(dek, rowA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := master.Open(wrapped, rowB); err == nil {
		t.Error("master.Open succeeded with wrong row AAD — row substitution possible")
	}
}
