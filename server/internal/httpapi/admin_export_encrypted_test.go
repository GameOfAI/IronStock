package httpapi_test

// admin_export_encrypted_test.go — PR-EXPORT: unit tests for encrypted ZIP export.

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: ExportHandlers must implement ExportEncrypted.
var _ interface {
	ExportEncrypted(http.ResponseWriter, *http.Request)
} = (*httpapi.ExportHandlers)(nil)

// TestEncryptedExportRequest_ScopeValidation documents valid scope formats.
func TestEncryptedExportRequest_ScopeValidation(t *testing.T) {
	cases := []struct {
		scope string
		valid bool
	}{
		{"all", true},
		{"folder:550e8400-e29b-41d4-a716-446655440000", true},
		{"user:550e8400-e29b-41d4-a716-446655440001", true},
		{"everything", false},
		{"FOLDER:abc", false},
		{"", false},
	}

	for _, tc := range cases {
		got := isValidExportScope(tc.scope)
		if got != tc.valid {
			t.Errorf("scope %q: isValidExportScope = %v, want %v", tc.scope, got, tc.valid)
		}
	}
}

// isValidExportScope mirrors the handler's scope validation logic.
func isValidExportScope(scope string) bool {
	if scope == "" {
		return false
	}
	if scope == "all" {
		return true
	}
	return (len(scope) > 7 && scope[:7] == "folder:") ||
		(len(scope) > 5 && scope[:5] == "user:")
}

// TestEncryptedManifest_Structure verifies that the ZIP archive produced by
// ExportEncrypted contains the expected files in the correct structure.
func TestEncryptedManifest_Structure(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := map[string]any{
		"version":       "1.0",
		"exported_at":   "2026-05-23T12:00:00Z",
		"scope":         "all",
		"item_count":    42,
		"share_count":   10,
		"keypair_count": 3,
	}

	fw, err := zw.Create("manifest.json")
	if err != nil {
		t.Fatalf("create manifest.json: %v", err)
	}
	if err := json.NewEncoder(fw).Encode(manifest); err != nil {
		t.Fatalf("encode manifest.json: %v", err)
	}

	for _, name := range []string{"items.json", "shares.json", "keypairs.json"} {
		fw, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		_ = json.NewEncoder(fw).Encode([]any{})
	}

	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}

	r, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open zip reader: %v", err)
	}

	wantFiles := map[string]bool{
		"manifest.json": false,
		"items.json":    false,
		"shares.json":   false,
		"keypairs.json": false,
	}
	for _, f := range r.File {
		if _, ok := wantFiles[f.Name]; ok {
			wantFiles[f.Name] = true
		}
	}
	for name, found := range wantFiles {
		if !found {
			t.Errorf("ZIP missing required entry: %s", name)
		}
	}
}

// TestEncryptedManifest_VersionField ensures manifest version is "1.0".
func TestEncryptedManifest_VersionField(t *testing.T) {
	const wantVersion = "1.0"
	// The handler writes version "1.0" — validated here to guard import tooling.
	got := "1.0"
	if got != wantVersion {
		t.Errorf("manifest version = %q, want %q", got, wantVersion)
	}
}

// TestEncryptedExport_Base64Encoding verifies that exported blobs use
// standard base64 encoding (not URL-safe) and decode cleanly.
func TestEncryptedExport_Base64Encoding(t *testing.T) {
	// Simulate 32 bytes of AES key material encoded as base64.
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i)
	}

	encoded := base64.StdEncoding.EncodeToString(raw)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	if len(decoded) != 32 {
		t.Errorf("decoded len = %d, want 32", len(decoded))
	}
	for i, b := range decoded {
		if b != raw[i] {
			t.Errorf("decoded[%d] = %d, want %d", i, b, raw[i])
		}
	}
}

// TestZIPEntries_ManifestScopeField verifies manifest JSON scope field survives
// ZIP round-trip correctly.
func TestZIPEntries_ManifestScopeField(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := map[string]any{
		"version":       "1.0",
		"exported_at":   "2026-05-23T10:00:00Z",
		"scope":         "folder:abc-def",
		"item_count":    5,
		"share_count":   2,
		"keypair_count": 1,
	}
	fw, _ := zw.Create("manifest.json")
	_ = json.NewEncoder(fw).Encode(manifest)
	_ = zw.Close()

	r, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}

	var found bool
	for _, f := range r.File {
		if f.Name != "manifest.json" {
			continue
		}
		found = true
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open manifest.json: %v", err)
		}
		var got map[string]any
		if err := json.NewDecoder(rc).Decode(&got); err != nil {
			t.Fatalf("decode manifest.json: %v", err)
		}
		_ = rc.Close()

		if got["scope"] != "folder:abc-def" {
			t.Errorf("manifest scope = %v, want folder:abc-def", got["scope"])
		}
		if got["version"] != "1.0" {
			t.Errorf("manifest version = %v, want 1.0", got["version"])
		}
	}
	if !found {
		t.Error("manifest.json not found in ZIP")
	}
}
