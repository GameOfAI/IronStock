// Package llm provides a thin LLM client for AI tag/relationship suggestions.
//
// Supported providers:
//   - "anthropic" — Anthropic Messages API (claude-sonnet-4-5 default)
//   - "openai"    — OpenAI-compatible API (GPT-4o default; Ollama via LLMBaseURL)
//
// Security: field values are NEVER sent to the LLM. Only name, description,
// tags (labels), and item_type are included in prompts (ADR-0004 §PII).
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrNotConfigured is returned when no LLM provider is set.
var ErrNotConfigured = errors.New("llm: no provider configured (set ENVANTER_LLM_PROVIDER)")

// SuggestionResult holds parsed suggestions from the LLM.
type SuggestionResult struct {
	Tags          []string        // suggested tag labels
	Relationships []RelSuggestion // suggested relationship targets
}

// RelSuggestion is a suggested relationship to another item.
type RelSuggestion struct {
	TargetName       string `json:"target_name"`
	RelationshipType string `json:"relationship_type"`
}

// Client is an LLM client that can generate item suggestions.
type Client struct {
	provider string
	apiKey   string
	baseURL  string
	model    string
	http     *http.Client
}

// New creates a Client. provider must be "anthropic" or "openai".
// Returns ErrNotConfigured when provider is empty.
func New(provider, apiKey, baseURL, model string) (*Client, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return nil, ErrNotConfigured
	}
	if provider != "anthropic" && provider != "openai" {
		return nil, fmt.Errorf("llm: unknown provider %q (use anthropic or openai)", provider)
	}
	if model == "" {
		switch provider {
		case "anthropic":
			model = "claude-sonnet-4-5"
		case "openai":
			model = "gpt-4o"
		}
	}
	if baseURL == "" {
		switch provider {
		case "anthropic":
			baseURL = "https://api.anthropic.com"
		case "openai":
			baseURL = "https://api.openai.com"
		}
	}
	baseURL = strings.TrimRight(baseURL, "/")
	return &Client{
		provider: provider,
		apiKey:   apiKey,
		baseURL:  baseURL,
		model:    model,
		http:     &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// SuggestForItem sends item metadata (name, description, tags, type) to the
// LLM and returns tag and relationship suggestions. Field values are never
// included — they are E2E encrypted and inaccessible.
func (c *Client) SuggestForItem(ctx context.Context, name, description, itemType string, existingTags []string) (*SuggestionResult, error) {
	prompt := buildPrompt(name, description, itemType, existingTags)

	var raw string
	var err error
	switch c.provider {
	case "anthropic":
		raw, err = c.callAnthropic(ctx, prompt)
	case "openai":
		raw, err = c.callOpenAI(ctx, prompt)
	default:
		return nil, ErrNotConfigured
	}
	if err != nil {
		return nil, err
	}
	return parseResponse(raw), nil
}

// buildPrompt constructs the system+user prompt. Field values are never included.
func buildPrompt(name, description, itemType string, existingTags []string) string {
	tagList := strings.Join(existingTags, ", ")
	if tagList == "" {
		tagList = "(none)"
	}
	return fmt.Sprintf(`You are an inventory management assistant. Given metadata about a credential or server item, suggest:
1. Up to 5 relevant tags (short, lowercase, hyphenated)
2. Up to 3 potential relationship types to other items

Item metadata:
- Name: %s
- Type: %s
- Description: %s
- Existing tags: %s

Respond in valid JSON only, no markdown, no extra text:
{"tags": ["tag1", "tag2"], "relationships": [{"target_name": "example", "relationship_type": "depends_on"}]}

Valid relationship types: hosted_on, accessed_via, depends_on, uses_tool, builds_to, scans_with, deploys_to`,
		name, itemType, description, tagList)
}

// parseResponse tries to extract suggestions from the LLM text output.
// Returns an empty result on parse failure rather than an error — suggestions
// are advisory and a bad response should not break the UI.
func parseResponse(raw string) *SuggestionResult {
	// Strip markdown code fences if present.
	raw = strings.TrimSpace(raw)
	if idx := strings.Index(raw, "{"); idx > 0 {
		raw = raw[idx:]
	}
	if idx := strings.LastIndex(raw, "}"); idx >= 0 && idx < len(raw)-1 {
		raw = raw[:idx+1]
	}

	var parsed struct {
		Tags          []string        `json:"tags"`
		Relationships []RelSuggestion `json:"relationships"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return &SuggestionResult{}
	}
	// Clamp to reasonable limits.
	if len(parsed.Tags) > 5 {
		parsed.Tags = parsed.Tags[:5]
	}
	if len(parsed.Relationships) > 3 {
		parsed.Relationships = parsed.Relationships[:3]
	}
	return &SuggestionResult{
		Tags:          parsed.Tags,
		Relationships: parsed.Relationships,
	}
}

// callAnthropic calls the Anthropic Messages API.
func (c *Client) callAnthropic(ctx context.Context, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      c.model,
		"max_tokens": 512,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm: anthropic request: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("llm: anthropic status %d: %s", resp.StatusCode, respBytes)
	}

	var out struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBytes, &out); err != nil || len(out.Content) == 0 {
		return "", fmt.Errorf("llm: anthropic parse: %w", err)
	}
	return out.Content[0].Text, nil
}

// callOpenAI calls an OpenAI-compatible Chat Completions API (GPT, Ollama, etc.).
func (c *Client) callOpenAI(ctx context.Context, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model": c.model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"max_tokens": 512,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm: openai request: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("llm: openai status %d: %s", resp.StatusCode, respBytes)
	}

	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &out); err != nil || len(out.Choices) == 0 {
		return "", fmt.Errorf("llm: openai parse: %w", err)
	}
	return out.Choices[0].Message.Content, nil
}
