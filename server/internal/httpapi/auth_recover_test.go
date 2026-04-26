package httpapi

import (
	"testing"
)

func TestValidateRecoverComplete_OK(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "newpassword12345",
		PublicKey:        make([]byte, 32),
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3, "m": 65536},
	}
	if err := validateRecoverComplete(req); err != nil {
		t.Errorf("ok case rejected: %v", err)
	}
}

func TestValidateRecoverComplete_BadPubKeyLen(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "newpassword12345",
		PublicKey:        make([]byte, 16), // wrong size
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateRecoverComplete(req); err == nil {
		t.Error("16-byte pub key accepted")
	}
}

func TestValidateRecoverComplete_ShortPassword(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "short", // < 12
		PublicKey:        make([]byte, 32),
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateRecoverComplete(req); err == nil {
		t.Error("short password accepted")
	}
}

func TestValidateRecoverComplete_NoPriv(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "newpassword12345",
		PublicKey:        make([]byte, 32),
		NewPrivateKeyEnc: nil,
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateRecoverComplete(req); err == nil {
		t.Error("nil priv accepted")
	}
}

func TestValidateRecoverComplete_ShortSalt(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "newpassword12345",
		PublicKey:        make([]byte, 32),
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 4),
		NewKEKParams:     map[string]any{"t": 3},
	}
	if err := validateRecoverComplete(req); err == nil {
		t.Error("short salt accepted")
	}
}

func TestValidateRecoverComplete_EmptyKEKParams(t *testing.T) {
	req := recoverCompleteRequest{
		NewPassword:      "newpassword12345",
		PublicKey:        make([]byte, 32),
		NewPrivateKeyEnc: []byte("blob"),
		NewKEKSalt:       make([]byte, 16),
		NewKEKParams:     map[string]any{},
	}
	if err := validateRecoverComplete(req); err == nil {
		t.Error("empty kek_params accepted")
	}
}
