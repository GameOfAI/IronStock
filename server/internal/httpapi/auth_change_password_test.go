package httpapi

import (
	"testing"
)

func TestValidateChangePassword_OK(t *testing.T) {
	req := changePasswordRequest{
		CurrentPassword:  "oldpassword12",
		NewPassword:      "newpassword12345",
		NewPrivateKeyEnc: []byte("ciphertext-blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3, "m": 65536},
	}
	if err := validateChangePassword(req); err != nil {
		t.Errorf("expected ok, got %v", err)
	}
}

func TestValidateChangePassword_MissingCurrent(t *testing.T) {
	req := changePasswordRequest{
		NewPassword:      "newpassword12345",
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateChangePassword(req); err == nil {
		t.Error("missing current_master_password accepted")
	}
}

func TestValidateChangePassword_ShortNew(t *testing.T) {
	req := changePasswordRequest{
		CurrentPassword:  "oldpassword12",
		NewPassword:      "short", // < 12
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateChangePassword(req); err == nil {
		t.Error("short password accepted")
	}
}

func TestValidateChangePassword_ShortSalt(t *testing.T) {
	req := changePasswordRequest{
		CurrentPassword:  "oldpassword12",
		NewPassword:      "newpassword12345",
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 4), // < 16
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateChangePassword(req); err == nil {
		t.Error("short salt accepted")
	}
}

func TestValidateChangePassword_EmptyKEKParams(t *testing.T) {
	req := changePasswordRequest{
		CurrentPassword:  "oldpassword12",
		NewPassword:      "newpassword12345",
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{},
	}
	if err := validateChangePassword(req); err == nil {
		t.Error("empty kek_params accepted")
	}
}

func TestValidateChangePassword_EmptyPriv(t *testing.T) {
	req := changePasswordRequest{
		CurrentPassword:  "oldpassword12",
		NewPassword:      "newpassword12345",
		NewPrivateKeyEnc: nil,
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateChangePassword(req); err == nil {
		t.Error("empty priv key accepted")
	}
}
