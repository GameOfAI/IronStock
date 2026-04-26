package httpapi

import (
	"testing"

	"envanter.app/server/internal/auth"
)

func TestBindingChanged_BothMatch(t *testing.T) {
	ua := "Mozilla/5.0"
	ip := "10.0.0.1"
	row := auth.SessionRow{UserAgent: &ua, IPAddress: &ip}
	if bindingChanged(row, "10.0.0.1", "Mozilla/5.0") {
		t.Error("identical UA/IP flagged as changed")
	}
}

func TestBindingChanged_IPMismatch(t *testing.T) {
	ua := "Mozilla/5.0"
	ip := "10.0.0.1"
	row := auth.SessionRow{UserAgent: &ua, IPAddress: &ip}
	if !bindingChanged(row, "10.0.0.2", "Mozilla/5.0") {
		t.Error("IP change not flagged")
	}
}

func TestBindingChanged_UAMismatch(t *testing.T) {
	ua := "Mozilla/5.0"
	ip := "10.0.0.1"
	row := auth.SessionRow{UserAgent: &ua, IPAddress: &ip}
	if !bindingChanged(row, "10.0.0.1", "curl/8.0") {
		t.Error("UA change not flagged")
	}
}

func TestBindingChanged_NilStored(t *testing.T) {
	// Old row has no UA/IP captured — nothing to compare → no flag.
	row := auth.SessionRow{}
	if bindingChanged(row, "10.0.0.1", "Mozilla") {
		t.Error("nil-stored row spuriously flagged")
	}
}

func TestBindingChanged_EmptyStored(t *testing.T) {
	empty := ""
	row := auth.SessionRow{UserAgent: &empty, IPAddress: &empty}
	if bindingChanged(row, "10.0.0.1", "Mozilla") {
		t.Error("empty-stored row spuriously flagged")
	}
}
