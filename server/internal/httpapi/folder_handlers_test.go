package httpapi

import "testing"

func TestValidateFolderRequest_OK(t *testing.T) {
	req := folderRequest{Name: "Üretim"}
	if err := validateFolderRequest(req); err != nil {
		t.Errorf("expected ok, got %v", err)
	}
}

func TestValidateFolderRequest_EmptyName(t *testing.T) {
	if err := validateFolderRequest(folderRequest{}); err == nil {
		t.Error("empty name accepted")
	}
}

func TestValidateFolderRequest_NameTooLong(t *testing.T) {
	long := make([]byte, 201)
	for i := range long {
		long[i] = 'a'
	}
	req := folderRequest{Name: string(long)}
	if err := validateFolderRequest(req); err == nil {
		t.Error("201-char name accepted")
	}
}

func TestNullableUUID_NilOrEmpty(t *testing.T) {
	if v := nullableUUID(nil); v != nil {
		t.Errorf("nil ptr -> %v, want nil", v)
	}
	empty := ""
	if v := nullableUUID(&empty); v != nil {
		t.Errorf("empty string ptr -> %v, want nil", v)
	}
}

func TestNullableUUID_Set(t *testing.T) {
	id := "abc-123"
	v := nullableUUID(&id)
	if v == nil {
		t.Fatal("got nil for non-empty UUID")
	}
	if s, ok := v.(string); !ok || s != "abc-123" {
		t.Errorf("got %v, want abc-123", v)
	}
}
