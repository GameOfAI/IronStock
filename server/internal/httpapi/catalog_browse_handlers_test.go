package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestParseCatalogBrowseParams_Defaults ensures zero-value params parse correctly.
func TestParseCatalogBrowseParams_Defaults(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/v1/catalog/items", nil)
	p, err := parseCatalogBrowseParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.limit != catalogDefaultLimit {
		t.Errorf("limit = %d, want %d", p.limit, catalogDefaultLimit)
	}
	if p.offset != 0 {
		t.Errorf("offset = %d, want 0", p.offset)
	}
	if p.typeID != nil {
		t.Errorf("typeID = %v, want nil", p.typeID)
	}
	if p.q != "" || p.tag != "" || p.severity != "" {
		t.Errorf("unexpected non-empty filter: %+v", p)
	}
}

// TestParseCatalogBrowseParams_AllFilters exercises every query parameter.
func TestParseCatalogBrowseParams_AllFilters(t *testing.T) {
	r := httptest.NewRequest("GET",
		"/api/v1/catalog/items?type_id=3&q=postgres&severity=warning&tag=prod&limit=25&offset=50", nil)
	p, err := parseCatalogBrowseParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.typeID == nil || *p.typeID != 3 {
		t.Errorf("typeID = %v, want 3", p.typeID)
	}
	if p.q != "postgres" {
		t.Errorf("q = %q, want postgres", p.q)
	}
	if p.severity != "warning" {
		t.Errorf("severity = %q, want warning", p.severity)
	}
	if p.tag != "prod" {
		t.Errorf("tag = %q, want prod", p.tag)
	}
	if p.limit != 25 {
		t.Errorf("limit = %d, want 25", p.limit)
	}
	if p.offset != 50 {
		t.Errorf("offset = %d, want 50", p.offset)
	}
}

// TestParseCatalogBrowseParams_LimitCap ensures limit is capped at catalogMaxLimit.
func TestParseCatalogBrowseParams_LimitCap(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/v1/catalog/items?limit=9999", nil)
	p, err := parseCatalogBrowseParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.limit != catalogMaxLimit {
		t.Errorf("limit = %d, want capped at %d", p.limit, catalogMaxLimit)
	}
}

// TestParseCatalogBrowseParams_InvalidSeverity rejects unknown severity values.
func TestParseCatalogBrowseParams_InvalidSeverity(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/v1/catalog/items?severity=ok", nil)
	if _, err := parseCatalogBrowseParams(r); err == nil {
		t.Error("expected error for invalid severity, got nil")
	}
}

// TestParseCatalogBrowseParams_InvalidTypeID rejects non-numeric or non-positive type_id.
func TestParseCatalogBrowseParams_InvalidTypeID(t *testing.T) {
	for _, v := range []string{"abc", "0", "-1"} {
		r := httptest.NewRequest("GET", "/api/v1/catalog/items?type_id="+v, nil)
		if _, err := parseCatalogBrowseParams(r); err == nil {
			t.Errorf("type_id=%q: expected error, got nil", v)
		}
	}
}

// TestCatalogBrowseResponse_JSONShape pins the wire format expected by the web
// frontend (web/src/api/catalog-browse.ts). Drift here breaks the UI.
func TestCatalogBrowseResponse_JSONShape(t *testing.T) {
	score := int16(85)
	sev := "healthy"
	exp := "2027-01-01T00:00:00Z"

	resp := catalogBrowseResponse{
		Total: 1,
		Items: []catalogBrowseItem{
			{
				ID:                "item-1",
				ItemTypeID:        1,
				FolderID:          "folder-1",
				FolderName:        "Infrastructure",
				Name:              "prod-postgres",
				Description:       "Primary database",
				HealthScore:       &score,
				HealthSeverity:    &sev,
				ExpiresAt:         &exp,
				Tags:              []string{"prod", "critical"},
				LifecycleStageIDs: []int32{1, 3},
				RelationshipCount: 4,
				IsFavorite:        true,
				Permission:        "owner",
			},
		},
	}

	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	body := string(b)

	for _, want := range []string{
		`"total":1`,
		`"id":"item-1"`,
		`"item_type_id":1`,
		`"folder_id":"folder-1"`,
		`"folder_name":"Infrastructure"`,
		`"name":"prod-postgres"`,
		`"health_score":85`,
		`"health_severity":"healthy"`,
		`"expires_at":"2027-01-01T00:00:00Z"`,
		`"tags":["prod","critical"]`,
		`"lifecycle_stage_ids":[1,3]`,
		`"relationship_count":4`,
		`"is_favorite":true`,
		`"permission":"owner"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s in JSON:\n%s", want, body)
		}
	}
}

// TestCatalogBrowseResponse_NilHealthOmitted ensures health_score null is
// marshaled as JSON null (not omitted) — frontend checks for null explicitly.
func TestCatalogBrowseResponse_NilHealthOmitted(t *testing.T) {
	resp := catalogBrowseResponse{
		Total: 0,
		Items: []catalogBrowseItem{
			{
				ID:                "x",
				Tags:              []string{},
				LifecycleStageIDs: []int32{},
			},
		},
	}
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	body := string(b)
	if !strings.Contains(body, `"health_score":null`) {
		t.Errorf("health_score null should appear as JSON null, got: %s", body)
	}
}
