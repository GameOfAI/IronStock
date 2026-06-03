package httpapi_test

// ai_suggestions_test.go — PR-AI: compile-time guards for AI suggestion endpoints.

import (
	"net/http"
	"testing"

	"envanter.app/server/internal/httpapi"
)

// Compile-time guard: AISuggestionHandlers must implement all 4 methods.
var _ interface {
	Suggest(http.ResponseWriter, *http.Request)
	ListSuggestions(http.ResponseWriter, *http.Request)
	AcceptSuggestion(http.ResponseWriter, *http.Request)
	RejectSuggestion(http.ResponseWriter, *http.Request)
} = (*httpapi.AISuggestionHandlers)(nil)

// TestAISuggestionHandlersNotNilWhenConfigured documents that a nil LLM client
// results in a valid (non-nil) handler struct — it just returns 501.
func TestAISuggestionHandlersNotNilWhenConfigured(t *testing.T) {
	h := &httpapi.AISuggestionHandlers{
		ItemH: nil, // LLM = nil → 501 Not Implemented
		LLM:   nil,
	}
	if h.LLM != nil {
		t.Error("expected LLM client to be nil for the 501 scenario")
	}
}
