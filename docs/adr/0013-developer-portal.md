# ADR-0013 — Developer Portal Architecture (Backstage Principles)

**Status:** Accepted  
**Date:** 2026-06-03  
**Deciders:** @burak.haslaman  

---

## Context

IronStock was originally a credential vault (KeePassXC alternative). The goal was to evolve the same application — without standing up a separate Backstage instance — into a Developer Portal that applies Backstage principles: entity catalog, kind system, plugin slot architecture, and Golden Path template wizard.

The constraints were:
1. E2E encryption must not be broken — secret fields never reach the server in plaintext.
2. 3-tier RBAC must be preserved.
3. Tauri (native client) must remain backward-compatible with existing API shapes.
4. Every new feature must be additive (no breaking changes to existing routes).

---

## Decision

### 1. Entity Kind System (DP02)

Rather than adopting Backstage's YAML-manifest approach, we extend the existing `item_types` table with a `kind_key TEXT` column. This maps IronStock item types to Backstage-compatible kind strings (e.g. `server` type → `Server` kind, `url` type → `Service` kind).

The `GET /api/v1/items` and `/api/v1/items/search` responses include `kind` and `owner_ref` fields as additive JSON fields — existing clients that ignore unknown fields continue working.

**Rationale:** No new model layer needed; the existing `item_types` table already provides the categorization. `kind_key` is a display-layer annotation on top of it.

### 2. Annotations (DP01)

A separate `item_annotations` table (`item_id + key TEXT + value TEXT`) stores freeform key-value metadata (analogous to Backstage `metadata.annotations`). This is separate from `item_fields` (which hold E2E encrypted values) and `tags` (which are named labels).

**Rationale:** Annotations are metadata about the entity (e.g. `grafana/dashboard-url`, `db/engine`), not secrets. They are stored as plaintext server-side and are appropriate for display in kind-specific overview cards.

### 3. Plugin Slot Architecture (DP07)

`EntityPageRegistry` is a React context that maps kind strings to ordered `EntityTab[]` arrays. A `registerTab(kind, tab)` / `getTabsForKind(kind)` API uses a mutable `useRef` Map to avoid re-renders on registration.

The existing 8-tab `ItemDetail` component remains intact; extra plugin tabs are appended dynamically based on `item.kind`. The wildcard kind `'*'` registers tabs for all entities.

**Rationale:** Avoids rewriting the proven `ItemDetail` component while enabling per-kind customization. The mutable ref pattern prevents infinite re-render loops that would occur if `useState` or `useReducer` were used for the registry.

### 4. Portal Templates (DP11)

A dedicated `portal_templates` table is used instead of the existing `item_templates` table. `item_templates` holds credential-field scaffolds (E2E encrypted defaults). Portal templates hold entity-creation blueprints: `default_fields JSONB`, `default_annotations JSONB`, `default_lifecycle_stages TEXT[]`, `default_relations JSONB`.

`is_builtin = true` templates cannot be deleted. Four built-in templates are seeded at migration time (Server, Database, Service, Certificate).

**Rationale:** The two template concepts have different schemas and different usage contexts. Merging them would require schema complexity with no benefit.

### 5. URL-Based Entity Routing (DP06)

New entity detail URLs follow the Backstage convention: `/catalog/:kind/:namespace/:name`. The legacy `/inventory?item=uuid` URL is preserved for Tauri backward compatibility.

The entity detail page resolves the item by searching `?q=name&kind=kind` and finding the exact match, rather than requiring a new backend `/catalog/:kind/:name` route.

**Rationale:** Avoids adding a new backend endpoint; the existing search endpoint is sufficient for exact-name lookup. The legacy URL remaining active means no Tauri rebuild is required.

### 6. Golden Path Wizard (DP10)

The 5-step wizard pre-generates a stable `newItemId = crypto.randomUUID()` before any mutations are called. This allows `useAddRelationshipMutation(itemId)` and `useSetItemLifecycleStagesMutation(itemId)` to be called at hook time (React rules of hooks) while the item doesn't exist yet.

E2E encryption in the wizard follows the same `sealDEKWithKEK` pattern as the item form modal: DEK is generated client-side, sealed with an AES-GCM wrap of SHA-256(privateKey), and sent as `owner_dek_wrapped`.

**Rationale:** Pre-generating the UUID is the minimal change that respects hooks ordering rules while enabling the sequential create → relate → lifecycle flow.

### 7. MCP Server Portal Tools (DP14)

Three read-only tools are added to the existing MCP server: `catalog_list_by_kind`, `catalog_get_entity`, `portal_list_templates`. `catalog_get_entity` fetches item detail, annotations, and relationships in sequence and merges them into a single JSON response for LLM consumption.

**Rationale:** LLM agents querying the portal need entity detail in a single call. Merging three API calls server-side in the MCP tool avoids multiple round-trips from the agent.

---

## Consequences

### Positive
- Backstage concepts adopted incrementally; no separate service deployed.
- All 15 PRs (DP01–DP15) are additive — zero breaking changes.
- E2E encryption, RBAC, and Tauri compatibility fully preserved.
- MCP server now exposes catalog-aware tools for DevOps automation.

### Negative / Trade-offs
- Kind system relies on `item_types.kind_key` rather than a proper entity manifest — no support for Backstage YAML import/export.
- Plugin slot registry is in-memory per page load; no persistence or admin UI for managing tab registrations.
- `catalog_get_entity` makes 3 sequential API calls; a future `/api/v1/catalog/:kind/:name` endpoint would be more efficient.

### Future Work
- Admin UI for portal template management (CRUD for non-builtin templates).
- OpenAPI spec update to reflect all new DP endpoints.
- Tauri `/catalog` route (currently uses 3-panel inventory layout).
- Backstage YAML import/export for entity manifests.
