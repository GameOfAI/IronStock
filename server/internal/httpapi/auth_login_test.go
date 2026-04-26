package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestExtractSaltFromParams_OK(t *testing.T) {
	salt := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	params := map[string]any{
		"time_cost":   3,
		"memory_cost": 65536,
		"salt_b64":    base64.StdEncoding.EncodeToString(salt),
	}
	js, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	got, err := extractSaltFromParams(js)
	if err != nil {
		t.Fatalf("extractSaltFromParams: %v", err)
	}
	if !bytes.Equal(got, salt) {
		t.Errorf("salt mismatch:\n got=%v\nwant=%v", got, salt)
	}
}

func TestExtractSaltFromParams_MissingSalt(t *testing.T) {
	js := []byte(`{"time_cost":3}`)
	if _, err := extractSaltFromParams(js); err == nil {
		t.Error("expected error for missing salt_b64")
	}
}

func TestExtractSaltFromParams_BadJSON(t *testing.T) {
	if _, err := extractSaltFromParams([]byte("{not-json")); err == nil {
		t.Error("expected error for bad JSON")
	}
}

func TestExtractSaltFromParams_BadBase64(t *testing.T) {
	js := []byte(`{"salt_b64":"not!valid?base64"}`)
	if _, err := extractSaltFromParams(js); err == nil {
		t.Error("expected error for bad base64 salt")
	}
}

func TestPtrStringOrEmpty(t *testing.T) {
	if ptrStringOrEmpty(nil) != "" {
		t.Error("nil ptr not empty string")
	}
	s := "hello"
	if ptrStringOrEmpty(&s) != "hello" {
		t.Error("ptr-to-hello returned wrong value")
	}
}
