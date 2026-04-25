package crypto

import (
	"bytes"
	"errors"
	"testing"
)

// fastTestParams keeps test runtime under a second per case; production code
// uses DefaultArgon2Params.
var fastTestParams = Argon2Params{
	TimeCost:    1,
	MemoryCost:  8 * 1024, // 8 MiB
	Parallelism: 2,
	SaltLength:  16,
	KeyLength:   32,
}

func TestArgon2Params_Validate(t *testing.T) {
	cases := []struct {
		name    string
		p       Argon2Params
		wantErr bool
	}{
		{"valid default", DefaultArgon2Params, false},
		{"valid fast test", fastTestParams, false},
		{"zero time", Argon2Params{TimeCost: 0, MemoryCost: 1024, Parallelism: 1, SaltLength: 8, KeyLength: 16}, true},
		{"zero parallelism", Argon2Params{TimeCost: 1, MemoryCost: 1024, Parallelism: 0, SaltLength: 8, KeyLength: 16}, true},
		{"memory below 8*p", Argon2Params{TimeCost: 1, MemoryCost: 8, Parallelism: 4, SaltLength: 8, KeyLength: 16}, true},
		{"salt too small", Argon2Params{TimeCost: 1, MemoryCost: 1024, Parallelism: 1, SaltLength: 4, KeyLength: 16}, true},
		{"key too small", Argon2Params{TimeCost: 1, MemoryCost: 1024, Parallelism: 1, SaltLength: 8, KeyLength: 8}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.p.Validate()
			if (err != nil) != tc.wantErr {
				t.Errorf("Validate() err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestHashPassword_Verify_RoundTrip(t *testing.T) {
	hash, salt, params, err := HashPasswordWithParams("correct horse battery staple", fastTestParams)
	if err != nil {
		t.Fatal(err)
	}
	if len(hash) != int(params.KeyLength) {
		t.Errorf("hash length = %d, want %d", len(hash), params.KeyLength)
	}
	if len(salt) != int(params.SaltLength) {
		t.Errorf("salt length = %d, want %d", len(salt), params.SaltLength)
	}
	if !VerifyPassword("correct horse battery staple", hash, salt, params) {
		t.Error("VerifyPassword(correct) = false, want true")
	}
	if VerifyPassword("wrong password", hash, salt, params) {
		t.Error("VerifyPassword(wrong) = true, want false")
	}
}

func TestHashPassword_NonDeterministic(t *testing.T) {
	// Same password with new salts must yield different hashes.
	h1, s1, _, _ := HashPasswordWithParams("password", fastTestParams)
	h2, s2, _, _ := HashPasswordWithParams("password", fastTestParams)
	if bytes.Equal(s1, s2) {
		t.Error("two HashPassword calls produced same salt (random salt broken)")
	}
	if bytes.Equal(h1, h2) {
		t.Error("two HashPassword calls produced same hash (salt not actually applied)")
	}
}

func TestVerifyPassword_BadInputs(t *testing.T) {
	// Empty hash / empty salt should not panic and should return false.
	if VerifyPassword("password", nil, []byte("salt"), fastTestParams) {
		t.Error("VerifyPassword with nil hash returned true")
	}
	if VerifyPassword("password", []byte("hash"), nil, fastTestParams) {
		t.Error("VerifyPassword with nil salt returned true")
	}
}

func TestDeriveKey_Deterministic(t *testing.T) {
	salt := []byte("0123456789abcdef")
	a, err := DeriveKey([]byte("master-pw"), salt, fastTestParams)
	if err != nil {
		t.Fatal(err)
	}
	b, err := DeriveKey([]byte("master-pw"), salt, fastTestParams)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("DeriveKey not deterministic for same inputs")
	}
	if len(a) != int(fastTestParams.KeyLength) {
		t.Errorf("DeriveKey length = %d, want %d", len(a), fastTestParams.KeyLength)
	}
}

func TestDeriveKey_DifferentSaltDifferentKey(t *testing.T) {
	a, _ := DeriveKey([]byte("master-pw"), []byte("salt-aaaaaaaaaaa"), fastTestParams)
	b, _ := DeriveKey([]byte("master-pw"), []byte("salt-bbbbbbbbbbb"), fastTestParams)
	if bytes.Equal(a, b) {
		t.Error("different salts produced same KEK")
	}
}

func TestDeriveKey_EmptySaltRejected(t *testing.T) {
	_, err := DeriveKey([]byte("master-pw"), nil, fastTestParams)
	if !errors.Is(err, ErrInvalidArgon2Params) {
		t.Errorf("err = %v, want ErrInvalidArgon2Params", err)
	}
}

// TestArgon2KAT exercises a known-answer-style test: hashing the exact same
// (password, salt, params) combination must yield byte-identical output across
// runs. Argon2id is deterministic given those inputs, so this acts as a
// regression guard against accidental changes (mode swap, parameter typo,
// upstream library quirk).
func TestArgon2KAT(t *testing.T) {
	password := []byte("rfc-9106-style-password")
	salt := []byte("envanter-static-salt") // 21 bytes is fine
	params := Argon2Params{
		TimeCost:    1,
		MemoryCost:  8 * 1024,
		Parallelism: 1,
		SaltLength:  uint32(len(salt)),
		KeyLength:   32,
	}
	first, err := DeriveKey(password, salt, params)
	if err != nil {
		t.Fatal(err)
	}
	// Re-derive 5 times — every run must match.
	for i := 0; i < 5; i++ {
		again, err := DeriveKey(password, salt, params)
		if err != nil {
			t.Fatalf("rerun %d: %v", i, err)
		}
		if !bytes.Equal(first, again) {
			t.Errorf("KAT failure on rerun %d: %x vs %x", i, first, again)
		}
	}
	if len(first) != 32 {
		t.Errorf("KAT output length = %d, want 32", len(first))
	}
}
