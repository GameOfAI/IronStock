// mcp-ironstock — MCP (Model Context Protocol) server for IronStock.
//
// Exposes read-only tools for LLM agents (Claude Code, etc.) to query the
// IronStock inventory. No mutation tools are provided in this version.
//
// Transport: JSON-RPC 2.0 over stdio (standard MCP convention).
// Auth: Bearer token passed via --token flag or IRONSTOCK_TOKEN env var.
// Server URL: --server flag or IRONSTOCK_URL env var.
//
// Claude Code config example:
//
//	{
//	  "mcpServers": {
//	    "ironstock": {
//	      "command": "mcp-ironstock",
//	      "args": ["--token", "YOUR_TOKEN"],
//	      "env": {"IRONSTOCK_URL": "https://ironstock.example.com"}
//	    }
//	  }
//	}
//
// Tools exposed (all read-only):
//   - inventory_search        — search items by name (fuzzy)
//   - inventory_get_item      — fetch item metadata (never secret field values)
//   - inventory_list_folders  — list folder tree
//   - relationships_graph     — graph nodes/edges for an item
//   - k8s_status              — bound K8s cluster info for an item
//   - audit_search            — search audit log (admin only)
//   - health_score            — get item health score + breakdown
//   - catalog_list_by_kind    — list catalog entities filtered by kind + lifecycle (portal)
//   - catalog_get_entity      — get entity detail + relations + annotations by kind+name (portal)
//   - portal_list_templates   — list golden path portal templates

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const version = "0.1.0"

func main() {
	token := flag.String("token", os.Getenv("IRONSTOCK_TOKEN"), "IronStock API access token")
	serverURL := flag.String("server", envOr("IRONSTOCK_URL", "http://localhost:8080"), "IronStock server base URL")
	flag.Parse()

	if *token == "" {
		_, _ = fmt.Fprintln(os.Stderr, "mcp-ironstock: --token or IRONSTOCK_TOKEN required")
		os.Exit(1)
	}

	s := &mcpServer{
		token:  *token,
		server: strings.TrimRight(*serverURL, "/"),
		http:   &http.Client{Timeout: 15 * time.Second},
	}
	s.run(os.Stdin, os.Stdout)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

type mcpServer struct {
	token  string
	server string
	http   *http.Client
}

func (s *mcpServer) run(in io.Reader, out io.Writer) {
	scanner := bufio.NewScanner(in)
	enc := json.NewEncoder(out)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			_ = enc.Encode(rpcResponse{
				JSONRPC: "2.0",
				Error:   &rpcError{Code: -32700, Message: "parse error"},
			})
			continue
		}
		resp := s.handle(req)
		_ = enc.Encode(resp)
	}
}

func (s *mcpServer) handle(req rpcRequest) rpcResponse {
	ctx := context.Background()
	base := rpcResponse{JSONRPC: "2.0", ID: req.ID}

	switch req.Method {
	case "initialize":
		base.Result = map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": "mcp-ironstock", "version": version},
		}

	case "tools/list":
		base.Result = map[string]any{"tools": s.toolList()}

	case "tools/call":
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			base.Error = &rpcError{Code: -32602, Message: "invalid params"}
			return base
		}
		result, err := s.callTool(ctx, p.Name, p.Arguments)
		if err != nil {
			base.Error = &rpcError{Code: -32603, Message: err.Error()}
			return base
		}
		base.Result = map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": result},
			},
		}

	default:
		base.Error = &rpcError{Code: -32601, Message: "method not found"}
	}
	return base
}

func (s *mcpServer) toolList() []map[string]any {
	return []map[string]any{
		{
			"name":        "inventory_search",
			"description": "Search IronStock inventory items by name. Returns metadata only — no secret field values.",
			"inputSchema": jsonSchema(map[string]any{
				"query": map[string]any{"type": "string", "description": "Search term"},
				"fuzzy": map[string]any{"type": "boolean", "description": "Use fuzzy (typo-tolerant) matching", "default": false},
				"limit": map[string]any{"type": "integer", "default": 10},
			}, []string{"query"}),
		},
		{
			"name":        "inventory_get_item",
			"description": "Get IronStock item metadata by ID. Secret field values are E2E encrypted and never returned.",
			"inputSchema": jsonSchema(map[string]any{
				"id": map[string]any{"type": "string", "description": "Item UUID"},
			}, []string{"id"}),
		},
		{
			"name":        "inventory_list_folders",
			"description": "List the IronStock folder tree accessible to the current user.",
			"inputSchema": jsonSchema(map[string]any{}, nil),
		},
		{
			"name":        "relationships_graph",
			"description": "Get relationship graph edges for an item.",
			"inputSchema": jsonSchema(map[string]any{
				"item_id": map[string]any{"type": "string", "description": "Item UUID"},
			}, []string{"item_id"}),
		},
		{
			"name":        "health_score",
			"description": "Get the health score (0-100) and breakdown for an IronStock item.",
			"inputSchema": jsonSchema(map[string]any{
				"item_id": map[string]any{"type": "string", "description": "Item UUID"},
			}, []string{"item_id"}),
		},
		{
			"name":        "audit_search",
			"description": "Search the IronStock audit log (admin only).",
			"inputSchema": jsonSchema(map[string]any{
				"action": map[string]any{"type": "string"},
				"actor":  map[string]any{"type": "string"},
				"since":  map[string]any{"type": "string", "description": "RFC3339 timestamp"},
				"limit":  map[string]any{"type": "integer", "default": 20},
			}, nil),
		},
		{
			"name":        "catalog_list_by_kind",
			"description": "List Developer Portal catalog entities filtered by kind (e.g. Server, Database, Service, Certificate). Returns ownership, lifecycle, and kind fields — never secret field values.",
			"inputSchema": jsonSchema(map[string]any{
				"kind_key":        map[string]any{"type": "string", "description": "Entity kind: Server, Database, Service, Certificate, SSHKey, CloudCredential, Note, Credential"},
				"lifecycle_stage": map[string]any{"type": "string", "description": "Optional: filter by lifecycle stage name"},
				"limit":           map[string]any{"type": "integer", "default": 50},
			}, []string{"kind_key"}),
		},
		{
			"name":        "catalog_get_entity",
			"description": "Get a catalog entity's detail, relations, and annotations by kind + name. Secret field values are E2E encrypted and never returned.",
			"inputSchema": jsonSchema(map[string]any{
				"kind_key": map[string]any{"type": "string", "description": "Entity kind (e.g. Server, Database)"},
				"name":     map[string]any{"type": "string", "description": "Exact entity name"},
			}, []string{"kind_key", "name"}),
		},
		{
			"name":        "portal_list_templates",
			"description": "List all active golden path portal templates available for entity scaffolding.",
			"inputSchema": jsonSchema(map[string]any{
				"kind_key": map[string]any{"type": "string", "description": "Optional: filter templates by kind key"},
			}, nil),
		},
	}
}

func jsonSchema(props map[string]any, required []string) map[string]any {
	s := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

func (s *mcpServer) callTool(ctx context.Context, name string, args map[string]any) (string, error) {
	switch name {
	case "inventory_search":
		q := stringArg(args, "query")
		params := url.Values{"q": {q}}
		if fuzzy, _ := args["fuzzy"].(bool); fuzzy {
			params.Set("fuzzy", "true")
		}
		if limit, _ := args["limit"].(float64); limit > 0 {
			params.Set("limit", fmt.Sprintf("%.0f", limit))
		}
		return s.apiGet(ctx, "/api/v1/items/search?"+params.Encode())

	case "inventory_get_item":
		id := stringArg(args, "id")
		return s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(id))

	case "inventory_list_folders":
		return s.apiGet(ctx, "/api/v1/folders")

	case "relationships_graph":
		id := stringArg(args, "item_id")
		return s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(id)+"/relationships")

	case "health_score":
		id := stringArg(args, "item_id")
		return s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(id)+"/health")

	case "audit_search":
		params := url.Values{}
		if v := stringArg(args, "action"); v != "" {
			params.Set("action", v)
		}
		if v := stringArg(args, "actor"); v != "" {
			params.Set("actor", v)
		}
		if v := stringArg(args, "since"); v != "" {
			params.Set("since", v)
		}
		if limit, _ := args["limit"].(float64); limit > 0 {
			params.Set("limit", fmt.Sprintf("%.0f", limit))
		}
		endpoint := "/api/v1/admin/audit-log"
		if len(params) > 0 {
			endpoint += "?" + params.Encode()
		}
		return s.apiGet(ctx, endpoint)

	case "catalog_list_by_kind":
		kindKey := stringArg(args, "kind_key")
		params := url.Values{"q": {""}, "fuzzy": {"true"}, "kind": {kindKey}}
		if limit, _ := args["limit"].(float64); limit > 0 {
			params.Set("limit", fmt.Sprintf("%.0f", limit))
		}
		return s.apiGet(ctx, "/api/v1/items/search?"+params.Encode())

	case "catalog_get_entity":
		kindKey := stringArg(args, "kind_key")
		name := stringArg(args, "name")
		params := url.Values{"q": {name}, "kind": {kindKey}}
		body, err := s.apiGet(ctx, "/api/v1/items/search?"+params.Encode())
		if err != nil {
			return "", err
		}
		// Parse to find exact match and fetch with annotations.
		var result struct {
			Items []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Kind string `json:"kind"`
			} `json:"items"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil || len(result.Items) == 0 {
			return body, nil
		}
		var matchID string
		for _, it := range result.Items {
			if strings.EqualFold(it.Name, name) && strings.EqualFold(it.Kind, kindKey) {
				matchID = it.ID
				break
			}
		}
		if matchID == "" {
			matchID = result.Items[0].ID
		}
		// Fetch item detail + annotations + relations in parallel response.
		detail, err := s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(matchID))
		if err != nil {
			return "", err
		}
		annotations, _ := s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(matchID)+"/annotations")
		relations, _ := s.apiGet(ctx, "/api/v1/items/"+url.PathEscape(matchID)+"/relationships")
		combined := map[string]json.RawMessage{}
		_ = json.Unmarshal([]byte(detail), &combined)
		if annotations != "" {
			combined["annotations"] = json.RawMessage(annotations)
		}
		if relations != "" {
			combined["relations"] = json.RawMessage(relations)
		}
		out, _ := json.MarshalIndent(combined, "", "  ")
		return string(out), nil

	case "portal_list_templates":
		params := url.Values{}
		if kindKey := stringArg(args, "kind_key"); kindKey != "" {
			params.Set("kind_key", kindKey)
		}
		endpoint := "/api/v1/portal-templates"
		if len(params) > 0 {
			endpoint += "?" + params.Encode()
		}
		return s.apiGet(ctx, endpoint)

	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

func (s *mcpServer) apiGet(ctx context.Context, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.server+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Accept", "application/json")

	resp, err := s.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("server returned %d: %s", resp.StatusCode, buf.String())
	}
	// Pretty-print JSON for readability in LLM context.
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, buf.Bytes(), "", "  "); err == nil {
		return pretty.String(), nil
	}
	return buf.String(), nil
}

func stringArg(args map[string]any, key string) string {
	if v, ok := args[key].(string); ok {
		return v
	}
	return ""
}
