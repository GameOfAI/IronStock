package auth

import (
	"bytes"
	"testing"
)

func TestGenerateRecoveryCodes_Counts(t *testing.T) {
	plain, hashes, err := GenerateRecoveryCodes(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) != 10 || len(hashes) != 10 {
		t.Errorf("counts = %d/%d, want 10/10", len(plain), len(hashes))
	}
	for i, p := range plain {
		// 8 random bytes hex-encoded → 16 chars
		if len(p) != 2*RecoveryCodeLength {
			t.Errorf("code %d len = %d, want %d", i, len(p), 2*RecoveryCodeLength)
		}
	}
}

func TestGenerateRecoveryCodes_Unique(t *testing.T) {
	plain, hashes, err := GenerateRecoveryCodes(5)
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool, 5)
	for _, p := range plain {
		if seen[p] {
			t.Errorf("duplicate code: %s", p)
		}
		seen[p] = true
	}
	for i := 0; i < len(hashes); i++ {
		for j := i + 1; j < len(hashes); j++ {
			if bytes.Equal(hashes[i], hashes[j]) {
				t.Errorf("duplicate hash at %d/%d", i, j)
			}
		}
	}
}

func TestVerifyRecoveryCode_RoundTrip(t *testing.T) {
	plain, hashes, err := GenerateRecoveryCodes(3)
	if err != nil {
		t.Fatal(err)
	}
	for i, code := range plain {
		if !VerifyRecoveryCode(code, hashes[i]) {
			t.Errorf("VerifyRecoveryCode(plain[%d]) = false", i)
		}
		if VerifyRecoveryCode("wrong-code-here", hashes[i]) {
			t.Errorf("VerifyRecoveryCode(wrong) at %d = true", i)
		}
	}
}

func TestVerifyRecoveryCode_BadBlob(t *testing.T) {
	if VerifyRecoveryCode("anything", []byte("too-short")) {
		t.Error("VerifyRecoveryCode accepted short blob")
	}
	if VerifyRecoveryCode("anything", nil) {
		t.Error("VerifyRecoveryCode accepted nil blob")
	}
}

func TestGenerateRecoveryCodes_RejectsZero(t *testing.T) {
	_, _, err := GenerateRecoveryCodes(0)
	if err == nil {
		t.Error("accepted n=0")
	}
}
