package k8s

import (
	"testing"
)

func TestValidateServerURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"valid HTTPS", "https://k8s.example.com:6443", false},
		{"valid HTTP", "http://192.168.1.100:6443", false},
		{"valid external IP", "https://10.0.0.1:6443", false},

		{"loopback IPv4", "https://127.0.0.1:6443", true},
		{"loopback IPv6", "https://[::1]:6443", true},
		{"localhost", "https://localhost:6443", true},
		{"link-local", "https://169.254.1.1:6443", true},
		{"cloud metadata", "http://169.254.169.254/latest/meta-data", true},
		{"GCP metadata", "http://metadata.google.internal", true},
		{"unspecified IPv4", "https://0.0.0.0:6443", true},
		{"empty host", "https://:6443", true},
		{"empty URL", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateServerURL(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateServerURL(%q) error = %v, wantErr %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestNewRejectsSSRF(t *testing.T) {
	cfg := Config{
		ServerURL: "https://127.0.0.1:6443",
		AuthMode:  AuthModeToken,
	}
	_, err := New(cfg)
	if err == nil {
		t.Fatal("expected error for loopback URL, got nil")
	}
}
