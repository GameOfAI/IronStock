package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func TestDeriveSearchKey_Deterministic(t *testing.T) {
	master, _ := RandomBytes(KeyLength)
	a, err := DeriveSearchKey(master, "envanter-search-v1")
	if err != nil {
		t.Fatal(err)
	}
	b, err := DeriveSearchKey(master, "envanter-search-v1")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("DeriveSearchKey not deterministic for same master+info")
	}
	if len(a) != KeyLength {
		t.Errorf("len = %d, want %d", len(a), KeyLength)
	}
}

func TestDeriveSearchKey_DifferentInfoGivesDifferentKey(t *testing.T) {
	master, _ := RandomBytes(KeyLength)
	a, _ := DeriveSearchKey(master, "envanter-search-v1")
	b, _ := DeriveSearchKey(master, "envanter-search-v2")
	if bytes.Equal(a, b) {
		t.Error("different info strings produced same search key — domain separation broken")
	}
}

func TestDeriveSearchKey_BadKeyLength(t *testing.T) {
	for _, n := range []int{0, 16, 31, 33, 64} {
		_, err := DeriveSearchKey(make([]byte, n), "info")
		if !errors.Is(err, ErrInvalidKeyLength) {
			t.Errorf("DeriveSearchKey(len=%d) err = %v, want ErrInvalidKeyLength", n, err)
		}
	}
}

func TestSearchHash_Deterministic(t *testing.T) {
	key, _ := RandomBytes(KeyLength)
	a, err := SearchHash(key, "Server01.prod")
	if err != nil {
		t.Fatal(err)
	}
	b, err := SearchHash(key, "Server01.prod")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("SearchHash not deterministic")
	}
	if len(a) != SearchHashLen {
		t.Errorf("len = %d, want %d", len(a), SearchHashLen)
	}
}

func TestSearchHash_CaseInsensitive(t *testing.T) {
	key, _ := RandomBytes(KeyLength)
	lower, _ := SearchHash(key, "server01")
	upper, _ := SearchHash(key, "SERVER01")
	mixed, _ := SearchHash(key, "Server01")
	if !bytes.Equal(lower, upper) || !bytes.Equal(lower, mixed) {
		t.Error("SearchHash is case-sensitive (case-folding broken)")
	}
}

func TestSearchHash_DifferentKeysDifferentHashes(t *testing.T) {
	k1, _ := RandomBytes(KeyLength)
	k2, _ := RandomBytes(KeyLength)
	a, _ := SearchHash(k1, "value")
	b, _ := SearchHash(k2, "value")
	if bytes.Equal(a, b) {
		t.Error("different keys produced same hash — key not bound to output")
	}
}

func TestSearchHash_DifferentInputsDifferentHashes(t *testing.T) {
	key, _ := RandomBytes(KeyLength)
	a, _ := SearchHash(key, "alpha")
	b, _ := SearchHash(key, "beta")
	if bytes.Equal(a, b) {
		t.Error("different inputs produced same hash")
	}
}

func TestSearchHash_BadKeyLength(t *testing.T) {
	_, err := SearchHash(make([]byte, 8), "value")
	if !errors.Is(err, ErrInvalidSearchKey) {
		t.Errorf("err = %v, want ErrInvalidSearchKey", err)
	}
}
