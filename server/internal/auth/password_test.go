package auth

import (
	"bytes"
	"encoding/json"
	"testing"

	"envanter.app/server/internal/crypto"
)

func TestHashPassword_RoundTrip(t *testing.T) {
	hp, err := HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatal(err)
	}
	if len(hp.Hash) == 0 || len(hp.Salt) == 0 {
		t.Fatal("empty hash or salt")
	}
	// Verify with the same password
	ok, err := VerifyPassword("correct-horse-battery-staple", hp.Hash, hp.Salt, hp.ParamsJSON)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Error("VerifyPassword(correct) = false")
	}
	// Wrong password rejected
	ok, _ = VerifyPassword("wrong-password", hp.Hash, hp.Salt, hp.ParamsJSON)
	if ok {
		t.Error("VerifyPassword(wrong) = true")
	}
}

func TestHashPassword_ParamsJSONRoundTripsToArgon2Params(t *testing.T) {
	hp, err := HashPassword("p")
	if err != nil {
		t.Fatal(err)
	}
	var got crypto.Argon2Params
	if err := json.Unmarshal(hp.ParamsJSON, &got); err != nil {
		t.Fatalf("unmarshal params: %v", err)
	}
	if got != hp.Params {
		t.Errorf("ParamsJSON differs from Params: %+v vs %+v", got, hp.Params)
	}
}

func TestVerifyPassword_BadParamsJSON(t *testing.T) {
	_, err := VerifyPassword("p", []byte("h"), []byte("s"), []byte("not-json"))
	if err == nil {
		t.Error("VerifyPassword accepted bad params JSON")
	}
}

func TestHashPassword_DifferentSaltsEachCall(t *testing.T) {
	a, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a.Salt, b.Salt) {
		t.Error("two HashPassword calls returned same salt")
	}
}
