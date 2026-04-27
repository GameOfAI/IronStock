package httpapi

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestLooksLikeUUID_Valid(t *testing.T) {
	good := []string{
		"01890dca-2200-7e85-9b1c-2c2bbf6bc65a", // v7 example
		"00000000-0000-0000-0000-000000000000",
		"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
	}
	for _, s := range good {
		if !looksLikeUUID(s) {
			t.Errorf("looksLikeUUID(%q) = false", s)
		}
	}
}

func TestLooksLikeUUID_Invalid(t *testing.T) {
	bad := []string{
		"",
		"not-a-uuid",
		"01890dca22007e859b1c2c2bbf6bc65a",       // no dashes
		"01890dca-2200-7e85-9b1c-2c2bbf6bc65",    // 35 chars
		"01890dca-2200-7e85-9b1c-2c2bbf6bc65aaa", // 38 chars
		"01890dcg-2200-7e85-9b1c-2c2bbf6bc65a",   // bad hex
	}
	for _, s := range bad {
		if looksLikeUUID(s) {
			t.Errorf("looksLikeUUID(%q) = true (expected false)", s)
		}
	}
}

func TestValidateItemCreate_OK(t *testing.T) {
	req := itemRequest{
		ID:              "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "prod-db",
		OwnerDEKWrapped: []byte("wrapped-dek-blob"),
		OwnerWrapNonce:  make([]byte, 12),
	}
	if err := validateItemCreate(req); err != nil {
		t.Errorf("expected ok, got %v", err)
	}
}

func TestValidateItemCreate_BadID(t *testing.T) {
	req := itemRequest{
		ID:              "not-a-uuid",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "x",
		OwnerDEKWrapped: []byte("blob"),
		OwnerWrapNonce:  make([]byte, 12),
	}
	if err := validateItemCreate(req); err == nil {
		t.Error("invalid id accepted")
	}
}

func TestValidateItemCreate_MissingName(t *testing.T) {
	req := itemRequest{
		ID:              "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "",
		OwnerDEKWrapped: []byte("blob"),
		OwnerWrapNonce:  make([]byte, 12),
	}
	if err := validateItemCreate(req); err == nil {
		t.Error("empty name accepted")
	}
}

func TestValidateItemCreate_BadNonceLen(t *testing.T) {
	req := itemRequest{
		ID:              "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "x",
		OwnerDEKWrapped: []byte("blob"),
		OwnerWrapNonce:  make([]byte, 8), // wrong size
	}
	if err := validateItemCreate(req); err == nil {
		t.Error("8-byte nonce accepted")
	}
}

func TestValidateItemCreate_NoDEKWrapped(t *testing.T) {
	req := itemRequest{
		ID:              "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "x",
		OwnerDEKWrapped: nil,
		OwnerWrapNonce:  make([]byte, 12),
	}
	if err := validateItemCreate(req); err == nil {
		t.Error("missing DEK accepted")
	}
}

func TestNilIfEmpty(t *testing.T) {
	if v := nilIfEmpty(nil); v != nil {
		t.Error("nil slice -> non-nil")
	}
	if v := nilIfEmpty([]byte{}); v != nil {
		t.Error("empty slice -> non-nil")
	}
	if v := nilIfEmpty([]byte("x")); v == nil {
		t.Error("non-empty slice -> nil")
	}
}

func TestNullableJSON(t *testing.T) {
	if v := nullableJSON(nil); v != nil {
		t.Error("nil RawMessage -> non-nil")
	}
	if v := nullableJSON(json.RawMessage(`null`)); v != nil {
		t.Error("'null' RawMessage -> non-nil")
	}
	v := nullableJSON(json.RawMessage(`{"type":"vault"}`))
	if v == nil {
		t.Fatal("real JSON -> nil")
	}
	got, ok := v.([]byte)
	if !ok {
		t.Fatal("expected []byte")
	}
	if !bytes.Equal(got, []byte(`{"type":"vault"}`)) {
		t.Errorf("got %s", got)
	}
}

func TestItemResponseJSON_OmitsEmptyDEK(t *testing.T) {
	resp := itemResponse{
		ID:         "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:   "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID: 1,
		Name:       "test",
		Fields:     []itemFieldOutput{},
	}
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["owner_dek_wrapped"]; ok {
		t.Error("owner_dek_wrapped should be omitted when nil")
	}
	if _, ok := m["owner_wrap_nonce"]; ok {
		t.Error("owner_wrap_nonce should be omitted when nil")
	}
}

func TestItemResponseJSON_IncludesDEK(t *testing.T) {
	resp := itemResponse{
		ID:              "01890dca-2200-7e85-9b1c-2c2bbf6bc65a",
		FolderID:        "01890dcb-1100-7e85-9b1c-2c2bbf6bc65a",
		ItemTypeID:      1,
		Name:            "test",
		Fields:          []itemFieldOutput{},
		OwnerDEKWrapped: []byte("wrapped-dek"),
		OwnerWrapNonce:  []byte("nonce-12byte"),
	}
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["owner_dek_wrapped"]; !ok {
		t.Error("owner_dek_wrapped should be present")
	}
	if _, ok := m["owner_wrap_nonce"]; !ok {
		t.Error("owner_wrap_nonce should be present")
	}
}

func TestFieldInputsToOutputs_Empty(t *testing.T) {
	got := fieldInputsToOutputs(nil)
	if len(got) != 0 {
		t.Errorf("nil -> len %d", len(got))
	}
}

func TestFieldInputsToOutputs_Roundtrip(t *testing.T) {
	in := []itemFieldInput{
		{FieldDefinitionID: 1, ValueEnc: []byte("a"), ValueNonce: []byte("n"), Position: 0},
		{FieldDefinitionID: 2, Position: 1}, // external — empty enc
	}
	out := fieldInputsToOutputs(in)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].FieldDefinitionID != 1 || !bytes.Equal(out[0].ValueEnc, []byte("a")) {
		t.Errorf("row 0 mismatch")
	}
	if out[1].FieldDefinitionID != 2 || len(out[1].ValueEnc) != 0 {
		t.Errorf("row 1 mismatch")
	}
}
