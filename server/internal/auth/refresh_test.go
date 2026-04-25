package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestGenerateRefresh_Fields(t *testing.T) {
	r, err := GenerateRefresh()
	if err != nil {
		t.Fatal(err)
	}
	// Token is hex-encoded RefreshTokenLength bytes => 2*N chars
	wantLen := 2 * RefreshTokenLength
	if len(r.Token) != wantLen {
		t.Errorf("Token len = %d, want %d", len(r.Token), wantLen)
	}
	if _, err := hex.DecodeString(r.Token); err != nil {
		t.Errorf("Token not valid hex: %v", err)
	}
	if len(r.Hash) != sha256.Size {
		t.Errorf("Hash len = %d, want %d", len(r.Hash), sha256.Size)
	}
	if !r.ExpiresAt.After(time.Now().Add(RefreshTokenLifetime - time.Minute)) {
		t.Errorf("ExpiresAt %v not in future", r.ExpiresAt)
	}
}

func TestGenerateRefresh_TokensUnique(t *testing.T) {
	a, err := GenerateRefresh()
	if err != nil {
		t.Fatal(err)
	}
	b, err := GenerateRefresh()
	if err != nil {
		t.Fatal(err)
	}
	if a.Token == b.Token {
		t.Error("two GenerateRefresh calls returned identical token")
	}
	if bytes.Equal(a.Hash, b.Hash) {
		t.Error("two GenerateRefresh calls returned identical hash")
	}
}

func TestHashRefresh_Deterministic(t *testing.T) {
	tok := "abc123"
	a := HashRefresh(tok)
	b := HashRefresh(tok)
	if !bytes.Equal(a, b) {
		t.Error("HashRefresh not deterministic")
	}
	if len(a) != sha256.Size {
		t.Errorf("len = %d, want %d", len(a), sha256.Size)
	}
}

func TestHashRefresh_DifferentTokensDifferentHashes(t *testing.T) {
	a := HashRefresh("token-a")
	b := HashRefresh("token-b")
	if bytes.Equal(a, b) {
		t.Error("different tokens produced same hash")
	}
}
