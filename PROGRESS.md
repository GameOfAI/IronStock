# İlerleyiş

Son güncelleme: 2026-04-26

## Mevcut Durum

- **Aktif Faz:** Faz 3 — Admin Web UI (PR-10 ✅ done, PR-11 sırada)
- **Tamamlanan Faz:** Faz 0 + Faz 1 + Faz 2 (server MVP) ✅ 2026-04-26
- **Çift makine workflow:** ▶ Mac (Pro) ↔ Win paralel. Win = 5 PR (server + foundation + auth + realtime/polish). Mac = 3 PR (admin + inventory ekranlar).
- **Bloker:** Yok
- **Bir sonraki adım:** **PR-11** — Server read API (audit query + field/type/user-pubkey + OpenAPI sync). Mac şu an repo inceleme + PR-W3 planlama yapıyor.

## Faz Durumu

| Faz | Durum | Başlangıç | Bitiş | Not |
|-----|-------|-----------|-------|-----|
| 0 — Temel kurulum | VERIFY | 2026-04-24 | 2026-04-24 | Kod yazıldı, lokal smoke test user tarafında |
| 1 — Veri modeli + kripto tasarımı | DONE | 2026-04-24 | 2026-04-24 | ER (17 tablo) + ADR 0004/0005/0006/0007 + auth-flow + 5 migration + OpenAPI + code gen |
| 2 — Server MVP | DONE | 2026-04-24 | 2026-04-26 | PR-1...PR-9 ✅ merged. 10 auth endpoint, folder/item CRUD, RBAC 3 katmanlı, E2E hibrit, 174 unit test, 17 migration. WebSocket → Faz 3, item_relationships + field/type admin → Faz 5 (parking). |
| 3 — Admin Web UI | ACTIVE | 2026-04-26 | — | 8 PR planlı (5 Win + 3 Mac). Win: PR-10 (server WS+admin), PR-11 (server read API), PR-W1 (web foundation), PR-W2 (web auth), PR-W6 (websocket+polish). Mac (Pro): PR-W3 (admin UI), PR-W4 (inventory read), PR-W5 (inventory write). Hedef: 5 günde Faz 3 BİTECEK. |
| 4 — Client MVP (Tauri) | TODO | — | — | Win+Mac, live sync, offline cache, E2E |
| 5 — Production hardening | PARTIAL | 2026-04-25 | — | Container + GHCR + k8s + ArgoCD + DB migration init container + native cross-compile multi-arch + secret rotation tamam. Sealed Secrets, Helm, observability, Ingress+TLS hâlâ TODO |

Durumlar: `DONE` tamamlandı · `ACTIVE` devam ediyor · `PARTIAL` parçalı tamamlandı · `VERIFY` doğrulama bekliyor · `BLOCKED` bloke · `TODO` beklemede

## Faz 0 Task İlerlemesi

- [x] Monorepo dizin yapısı
- [x] Root config dosyaları (.gitignore, .editorconfig, README, LICENSE, Makefile, .env.example, go.work)
- [x] Go modülü + workspace (server/go.mod + cmd/api/main.go healthz + internal/ doc.go iskeleti)
- [x] Docker Compose dev stack (Postgres 16 + Adminer + Mailhog)
- [x] golangci-lint config (.golangci.yml) + pre-commit hook (.pre-commit-config.yaml, gitleaks dahil)
- [x] GitHub Actions CI iskeleti (server job + pre-commit job)
- [x] İlk 3 ADR (tech-stack, security-model, repo-layout) + docs/adr/README
- [x] Web (admin) iskeleti (Vite + React + TS + ESLint + Prettier)
- [x] Tauri client iskeleti (Rust src-tauri + Vite + React + TS)
- [x] Faz 0 smoke test kılavuzu (docs/smoke-test.md)
- [ ] **User aksiyonu:** Smoke test'in lokalde çalıştırılması ve CI'ın ilk push'ta yeşile gelmesi

## Faz 1 Task İlerlemesi

- [x] ER diyagram (Mermaid) — `docs/diagrams/er.mmd` (11 tablo: auth + inventory + audit + keys)
- [x] Şifreleme detayları ADR — `docs/adr/0004-encryption-details.md` (AES-256-GCM + Argon2id + X25519 + HMAC search)
- [x] Migration tool ADR — `docs/adr/0005-migration-tool.md` (goose seçimi)
- [x] Auth flow dokümantasyonu — `docs/auth-flow.md` (9 senaryo Mermaid sequence diagram)
- [x] Tasarım review — 6 karar netleşti (UUID v7, MFA mandatory, recovery=new keypair, auto-lock 10dk, searchable enc kabul, session binding=flag)
- [x] İlk 5 migration: `00001_init_extensions` + `00002_users` + `00003_roles` + `00004_sessions` + `00005_audit_log`
- [x] OpenAPI v1 taslak — `shared/api/openapi.yaml` (health + 10 auth endpoint)
- [x] Code gen pipeline: `server/sqlc.yaml` + `server/oapi-codegen.yaml` + Makefile `gen`/`gen-*` hedefleri
- [x] sqlc query örnekleri: `server/queries/{users,sessions,roles,audit_log}.sql`
- [ ] **User aksiyonu:** Lokal tool'ları kur (`make tools-install` — sqlc, oapi-codegen, goose, golangci-lint), `make gen` + `make migrate-up` çalıştır, schema'yı Adminer'da doğrula.

## Günlük

### 2026-04-27 (Win) — Faz 3 PR-10: WebSocket hub + admin user mgmt endpoints

**Branch:** `feat/server-ws-admin` — review/merge bekliyor.

**Yeni paket: `internal/ws/`**

| Dosya | İçerik |
|-------|--------|
| `doc.go` | Architecture diagram + concurrency model + event payload felsefesi (minimal — client REST ile re-fetch eder, RBAC sızıntısız) |
| `events.go` | 9 Event type sabit (`folder.{created,updated,deleted}`, `item.{created,updated,deleted,shared,unshared,field_updated}`) + `Event{Type,ResourceID,ActorUserID,Timestamp}` + `NewEvent()` |
| `hub.go` | `Hub` (ctx + cancel + sync.RWMutex + connections map) + `NewHub` / `Close` (graceful) + `Register` / `Publish` (drop on overflow, no block) + `Stats` + `Accept`. `Connection` (id, userID, send chan, runReader, runWriter, ping ticker 30s, write timeout 10s) + `Closed()` channel + `closeOnce` |

**Critical karar: Hub kendi ctx'i kullanıyor.** Chi'nin `Timeout` middleware'i `http.TimeoutHandler` üstüne kurulu, Hijack'ı **desteklemez** → WebSocket upgrade kırılır. Çözüm: Hub'a kendi `context.WithCancel(context.Background())` kontekstini veriyorum, runReader/runWriter goroutine'leri buna anchor olur. Request ctx upgrade'den sonra kullanılmaz. `r.Context().Done()` yerine `c.Closed()` channel'ı ile parking yapıyoruz.

**Router refactor:** `Timeout(30s)` artık global değil. REST grupları (`/api/v1/auth`, `/folders`, `/items`, `/admin`) içinde `ar.Use(timeoutMW)` ile uygulanır. WebSocket route'u (`/api/v1/ws`) çıplak — uzun süreli bağlantı timeout-wrapper'sız.

**Yeni endpoint'ler (admin, RoleAdmin gerekir):**

`GET /api/v1/admin/users[?limit=&offset=]` (default 50, max 200)
- Pagination (limit + offset + total count). `array_agg + ORDER BY username`. Per-row `fetchUserRoles` çağrısı (small N — page max 200).
- Yanıt: `{users[], total, limit, offset}` her satır id/username/email/status/roles[]/last_login_at/created_at.

`POST /api/v1/admin/users/:id/disable`
- `users.status='disabled'` + tek tx içinde `RevokeAllUserSessions(reason='admin')`. Self-disable engeli.
- Idempotent (already-disabled → 204). Audit `admin.user_disabled`.

`POST /api/v1/admin/users/:id/enable`
- `status='disabled'`'dan recovery: TOTP verified varsa 'active', yoksa 'pending_totp' (tutarlılık koruması).
- Lockout reset etmez (ayrı concern). Idempotent. Audit `admin.user_enabled`.

`POST /api/v1/admin/users/:id/roles`
- Body: `{role: "admin"|"write"|"read"}`. ON CONFLICT DO NOTHING (idempotent re-grant).
- Audit `admin.role_granted` (target_user_id + role).

`DELETE /api/v1/admin/users/:id/roles/:role_name`
- **Self-strip-admin engeli:** kendi admin rolünü kaldıramaz (sistemde tek kalan admin'in kendini kilitlemesini önler).
- Idempotent. Audit `admin.role_revoked`.

**Yeni: `GET /api/v1/ws` (Bearer access in Authorization header)**
- JWT validate (purpose=access) → `websocket.Accept` (subprotocol `envanter.v1`) → Hub.Register → `<-c.Closed()` parking
- Reader: inbound frame'leri tüketir (MVP'de business message yok, sadece disconnect detection)
- Writer: send chan drain + 30s ping ticker (proxy/LB cull engeli)

**Hub.Publish entegrasyonu:**
- `FolderHandlers` + `ItemHandlers` artık `Hub *ws.Hub` field'ı taşıyor (nil-safe — `publishEvent` no-op ise)
- 9 endpoint mutate ettikten sonra `h.publishEvent(ws.EventXXX, resourceID, actorUserID)` çağırıyor
- Audit yazıldıktan sonra publish (audit tx commit'inden sonra, başarısız işlem broadcast etmez)

**Audit constants (4 yeni):**
- `admin.user_disabled`, `admin.user_enabled`, `admin.role_granted`, `admin.role_revoked`

**Yeni dependency:**
- `github.com/coder/websocket v1.8.12` (modern, context-aware, küçük API; gorilla/websocket archived)

**Wire:**
- `httpapi.Deps.Admin *AdminHandlers`, `Deps.WS *WSHandlers`
- `cmd/api/main.go`: hub erken yaratılır (defer Close), folder/item handlers'a Hub field'ı geçer, admin/ws handlers ayrı

**Tests (~7 yeni case, toplam 181 PASS):**
- `ws/hub_test.go`: Event field stamp + NewHub stats=0 + Publish-no-conns no-op + Close idempotent + 9 event constant pin
- `httpapi/admin_users_test.go`: validRoleName whitelist (3 valid + 5 invalid) + parseIntDefault clamping (8 case)

Handler-level DB integration testleri PR-11 sonrası testcontainers ile gelecek.

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 181 case PASS (önceki 174 + 7 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Sıradaki:** PR-11 — Server read API (audit query + field/type/user-pubkey + OpenAPI sync). Mac PR-W3 (admin UI) için backend hazır oluyor.

### 2026-04-26 (Win) — Faz 3 başlıyor: PR planlaması + Mac (Pro) ↔ Win iş bölümü

**Faz 2 BİTTİ** (PR-9 merge `08786e7`). Server tarafı tam fonksiyonel: register/TOTP/login/refresh/logout/change-pwd/recover + folder CRUD + item CRUD + paylaşım + RBAC + audit + brute-force guards. 174 unit test PASS, 17 migration, ~10K LOC.

**Faz 3 — Admin Web UI** başlıyor. Kullanıcı tarayıcıdan envanter işlemlerini yapabilir hale gelecek.

**Karar: Mac (Pro) ↔ Win paralel iş bölümü.**

Mac Pro paketi → daha az token. Self-contained ekran PR'ları Mac'e, mimari + entegrasyon Win'e. Win 5 PR, Mac 3 PR.

**Win (5 PR):**

| # | Branch | Kapsam | LOC | Sıra |
|---|--------|--------|-----|------|
| PR-10 | `feat/server-ws-admin` | Server: WebSocket hub `/ws` (access token gate, broadcast pub/sub) + admin user mgmt endpoints (list/disable/role-grant) | ~1000 | 1. |
| PR-11 | `feat/server-readapi` | Server: audit log query (admin, pagination + filter) + `GET /field-definitions` + `GET /item-types` + `GET /users/:id/public-key` + OpenAPI sync | ~700 | 2. |
| PR-W1 | `feat/web-foundation` | Web: API client SDK (fetch + token storage + refresh rotation) + layout (sidebar/topbar) + routing (auth-gate) + error mapping + toast | ~1100 | 3. |
| PR-W2 | `feat/web-auth` | Web: login + TOTP setup + recover screens + change-password modal | ~900 | 4. |
| PR-W6 | `feat/web-realtime-polish` | Web: WebSocket integration + i18n (Türkçe) + dark mode + responsive + a11y | ~800 | son (Mac PR-W5 sonrası) |

**Mac Pro (3 PR — self-contained ekranlar):**

| # | Branch | Kapsam | LOC | Bağımlılık |
|---|--------|--------|-----|------------|
| PR-W3 | `feat/web-admin` | Admin user list + role assign + disable/enable + audit log viewer (filter + pagination) | ~800 | PR-10, PR-11, PR-W2 |
| PR-W4 | `feat/web-inventory-read` | Folder tree (sol sidebar) + item list (orta panel, search box) + item detail panel (sağ, read-only) | ~1300 | PR-11, PR-W2 |
| PR-W5 | `feat/web-inventory-write` | Folder create/rename/delete + item create/edit form (field tipleri) + delete + paylaşım modal | ~1200 | PR-W4 |

**Toplam:** 8 PR, ~8000 LOC.

**Hız zinciri (5 günlük hedef):**

```
Gün 1: Win PR-10 (server WS+admin)
Gün 2: Win PR-11 (server read API) + PR-W1 (web foundation)
Gün 3: Win PR-W2 (auth) ║ Mac PR-W3 (admin) — paralel
Gün 4: Win bekler/Faz 5 prep ║ Mac PR-W4 (inventory read)
Gün 5: Win PR-W6 (websocket+polish) ║ Mac PR-W5 (inventory write)
       → FAZ 3 BİTER
```

**Çakışma koruması:**
- `server/**` → Win sahibi
- `web/**` → 3. gün öncesi Win, sonrası Mac (W3-W5 farklı route'lar)
- `shared/api/openapi.yaml` → Win (PR-11'de sync edilir)
- `PROGRESS.md` / `TODO.md` → ikisi de günlük entry yazar (tarih + makine etiketi)

**Erteleme (Faz 4-5'e):**
- Tauri client (Faz 4) — Win+Mac native
- Production hardening (Faz 5) — Sealed Secrets, Helm, observability, packaging
- item_relationships endpoint, field/type admin API → Faz 5 parking

**Sıradaki adım (Win):** PR-10'a başlıyorum — server WebSocket hub + admin endpoints.

### 2026-04-26 (Win) — Faz 2 PR-9: Item CRUD + item_shares + RBAC item resolver — **FAZ 2 SON HALKA**

**Branch:** `feat/server-item-crud` — review/merge bekliyor.

**Bu PR merge edilince Faz 2 BİTİYOR.** Server tarafında envanter işlemleri tam fonksiyonel: register → TOTP → login → folder CRUD → item CRUD → paylaşım. Faz 3 (Admin Web UI) buna bağlanmaya hazır.

**Yeni endpoint'ler (`internal/httpapi/item_*.go`):**

`POST /api/v1/items` (Bearer access)
- Body: `{id (UUID v7, client-gen), folder_id, item_type_id, name, fields[], owner_dek_wrapped, owner_wrap_nonce, external_source?}`
- **id client-generated UUID v7** (ADR-0004 §5.4): AAD-pending sorununu çözer. Server `gen_random_uuid()` kullanmaz — AAD bağlanması için id önceden bilinmeli.
- Folder Write check (admin bypass).
- **Two-layer envelope (ADR-0004 §6):**
  1. server_dek = 32B random (per-item)
  2. server_dek_wrapped = master.Seal(server_dek, AAD=`items:{id}:server_dek`)
  3. dekCipher = NewCipher(server_dek)
  4. name_enc = dekCipher.Seal(name, AAD=`items:{id}:name_enc`)
  5. name_search = HMAC-SHA256(name)[:16]
- Atomic tx: items INSERT + item_shares owner row (write, X25519 wrapped DEK from client) + item_fields[] INSERT.
- Field değerleri **client-encrypted** (E2E) — server `value_enc + value_nonce` blob'larını sadece saklar.
- Audit `item.created` (folder_id + item_type_id + field_count).

`GET /api/v1/items?folder_id=X[&q=...]` (Bearer access)
- folder_id zorunlu (DOS guard — tüm item'ları tek seferde dökmesin).
- folder Read check; reddedilirse boş list (existence oracle yok).
- q optional: `name_search = HMAC(q)` blind index lookup, deterministik eşleşme.
- Her satır için `ResolveItemPermission` → permission field'ı yanıta eklenir.

`GET /api/v1/items/{id}` (Bearer access)
- ResolveItemPermission Read check; reddedilirse 404 (oracle yok).
- name decrypt (DEK unwrap → DEK cipher.Open).
- Fields array_agg ile döner (client-encrypted blob'lar olduğu gibi).

`PUT /api/v1/items/{id}` (Bearer access)
- Rename + folder move + fields replace-all.
- Item Write check + (re-parent ise) destination folder Write check.
- Mevcut DEK reuse (rotate yok); name yeniden encrypt.
- `item_fields` DELETE + INSERT (replace-all semantik).
- Audit `item.updated`.

`DELETE /api/v1/items/{id}` (Bearer access)
- Write check. Schema CASCADE: item_fields, item_shares, item_relationships otomatik silinir.
- Audit `item.deleted`.

`POST /api/v1/items/{id}/shares` (Bearer access)
- Body: `{user_id, permission, dek_wrapped, wrap_nonce}`. UPSERT (re-share = update + revoked_at=NULL).
- `dek_wrapped` client'tan: owner kendi RAM'indeki DEK'i recipient'in pub_key'i ile X25519 sealed-box wrap'lar.
- Self-share engeli (owner zaten erişebilir).
- Audit `item.shared` (target_user_id + permission).

`DELETE /api/v1/items/{id}/shares/{user_id}` (Bearer access)
- Soft revoke. **Owner share koruması:** `target_user_id == items.created_by` ise 400 (item orphan'lanmaz).
- Idempotent. Audit `item.unshared`.

**Yeni `internal/auth/items.go`:**

`ResolveItemPermission(ctx, db, userID, itemID) ItemPermission`
- 3 sub-query (recursive CTE yerine — micro-bench: indexed PK lookup'lar daha hızlı):
  1. `items` row → folder_id + created_by (existence + owner check)
  2. `item_shares` direct grant (revoked_at IS NULL)
  3. `ResolveFolderPermission` (folder ancestor walk)
- Kombinasyon: max(owner=Write, share, folder) — Write ve Read birleşimi → Write.
- Owner ve direct-write short-circuit'leri (gereksiz folder query atlama).
- Item yoksa veya hiç grant yoksa → ItemPermNone.

`ItemPermission` tip + `AllowsRead/Write` semantiği.

**Yeni audit constants (6):**
- `item.created`, `item.updated`, `item.deleted`, `item.field_updated`, `item.shared`, `item.unshared`

**`extractNonce` refactor:** unused `nonceLen` parametresi kaldırıldı (her zaman `crypto.AESGCMNonceLen`). Çağıranlar güncellendi (auth_totp, folder_handlers, item_handlers).

**Wire:**
- `httpapi.Deps.Item *ItemHandlers`.
- `/api/v1/items/*` `RequireAccessToken` middleware altında.
- `cmd/api/main.go` ItemHandlers instance.

**Tests (~16 yeni case, toplam 174 PASS):**
- `auth/items_test.go`: ItemPermission.AllowsRead/Write matrix (6) + maxItemPerm (5) + folderPermToItemPerm (3) + ResolveItemPermission empty arg guard (2).
- `httpapi/item_handlers_test.go`: looksLikeUUID (3 valid + 6 invalid) + validateItemCreate (5 case) + nilIfEmpty (3) + nullableJSON (3) + fieldInputsToOutputs (2).

Handler-seviyesi DB integration testleri Faz 3 öncesi PR'ında testcontainers ile gelecek (real folder + item + share matrix).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 174 case PASS (önceki 158 + 16 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**🎯 Faz 2 tamamlanma kriterleri (PR-9 merge sonrası):**
- ✓ Auth surface (10 endpoint: register/totp/login/refresh/logout/logout-all/change-pwd/recover-init/recover-complete + tmp_token gate)
- ✓ Inventory CRUD (folder + item, RBAC enforced)
- ✓ Sharing (folder ACL + item_shares, X25519 sealed-box wrap)
- ✓ Audit log (24 action constant)
- ✓ Brute-force guards (rate limit + account lockout)
- ✓ E2E hibrit model: metadata server-side envelope, secret field'lar client-side
- ✓ 174 unit test PASS
- ⏸ WebSocket → Faz 3 (web UI ile birlikte)
- ⏸ item_relationships + field/type admin → Faz 5 (parking)

**Sıradaki:** Faz 3 — Admin Web UI. Mac (Pro) ↔ Win paralel PR planlaması. WebSocket de bu fazla geliyor.

### 2026-04-26 (Win) — Faz 2 PR-8: Folder CRUD + folder_permissions + RBAC ancestor walk

**Branch:** `feat/server-folder-crud` — review/merge bekliyor.

**Faz 2 son halkası 2'ye bölündü:** Eski tek-PR plan (Item + Folder + Relationships + WebSocket) çok büyüktü. Üç ertelemenin **mimari cost-of-delay analizi** sonucu (her biri 0 cost, schema hazır):

- WebSocket `/ws` → Faz 3 (web UI ile birlikte gerçek consumer çıkacak)
- Item relationships → Faz 5 / parking lot (00017 migration zaten kurulu, endpoint kolayca eklenir)
- Field definitions / item types admin API → Faz 5 (30 alan + 8 tip seed'li, MVP yeterli)

**Yeni bölünme:**
- **PR-8 (bu):** Folder CRUD + folder_permissions + RBAC folder resolver
- **PR-9 (sıradaki):** Item CRUD + item_shares + RBAC item resolver → **Faz 2 BİTECEK**

**Yeni endpoint'ler (`internal/httpapi/folder_*.go`):**

`POST /api/v1/folders` (Bearer access)
- Body: `{name, parent_id?, position}`. Server-side envelope encrypt name (master cipher, AAD=`folders:*:name_enc`) + HMAC blind index `name_search`.
- Permission gate: `parent_id IS NULL` (root folder) → admin only (ADR-0006 §3, sibling tree açma engeli). Aksi: `ResolveFolderPermission` Write check.
- Audit `folder.created` (parent_id details).

`GET /api/v1/folders[?parent_id=]` (Bearer access)
- parent_id boş → root folder list (her satır için Read check, görünmeyenler filtrelenir).
- parent_id set → o folder'ın altındaki çocuklar (önce parent Read check).
- Admin tüm satırları görür.
- Her response satırına `permission` field'i (UI hide-edit-buttons için).

`GET /api/v1/folders/{id}` (Bearer access)
- Read check; reddedilirse 404 (existence oracle yok).

`PUT /api/v1/folders/{id}` (Bearer access)
- Rename + re-parent. Re-parenting → BOTH source AND destination Write gerekir.
- Audit `folder.updated`.

`DELETE /api/v1/folders/{id}` (Bearer access)
- Write check. Schema CASCADE: alt folder'lar + item'lar + permissions otomatik silinir.
- Audit `folder.deleted`.

`POST /api/v1/folders/{id}/permissions` (Bearer access)
- Body: `{user_id, permission, inherit_to_children}`. UPSERT (re-grant aynı user için update + revoked_at=NULL geri set).
- Self-grant engeli (admin değilse, kendine yetki vermek anlamsız).
- Audit `folder.permission_granted` (target_user_id + permission + inherit).

`DELETE /api/v1/folders/{id}/permissions/{user_id}` (Bearer access)
- Soft revoke (revoked_at=now). Idempotent. Audit `folder.permission_revoked`.

**Yeni `internal/auth/folders.go`:**

`ResolveFolderPermission(ctx, db, userID, folderID) FolderPermission`
- Tek SQL CTE recursive: target folder'dan parent_id zinciri ile root'a kadar yürür.
- LEFT JOIN folder_permissions (revoked_at IS NULL).
- 4 bool aggregate: is_owner / has_write / has_read / folder_exists.
- Kural: `depth=0` (target folder) için inherit_to_children önemsiz; ata satırlar için sadece `inherit_to_children=true` count edilir.
- Return: FolderPermNone (existence oracle yok — folder yoksa veya yetki yoksa aynı), FolderPermRead, FolderPermWrite.

`FolderPermission` tip + `AllowsRead()` / `AllowsWrite()` semantiği (Write satisfies Read).

**Audit constants:**
- 5 yeni: `folder.created`, `folder.updated`, `folder.deleted`, `folder.permission_granted`, `folder.permission_revoked`
- `ResourceFolder = "folder"`

**Wire (`cmd/api/main.go` + `router.go`):**
- `httpapi.Deps.Folder *FolderHandlers` (optional, nil-safe).
- `/api/v1/folders/*` routes `RequireAccessToken(d.Auth.Service.JWT)` middleware altında.

**Tests (~8 yeni case, toplam 158 PASS):**
- `auth/folders_test.go`: FolderPermission.AllowsRead/Write matrix (6 case) + ResolveFolderPermission empty arg guard
- `httpapi/folder_handlers_test.go`: validateFolderRequest 3 case + nullableUUID 2 case

Handler-seviyesi DB integration test'leri PR-9'da Item CRUD ile birlikte testcontainers ile yazılacak (auth.DBExec mock'lamak yerine gerçek Postgres ile).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 158 case PASS (önceki 150 + 8 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-9 — Faz 2 son PR):**
- Item CRUD (metadata envelope + secret client-provided)
- Item field değerleri (envelope encrypt + AAD)
- item_shares + ResolveItemPermission (folder ancestor + per-item share birleşim)
- Item search (HMAC blind index, hostname/ip için)

**Sıradaki:** PR-9 — **Faz 2 son PR'ı**. Item CRUD + item_shares + RBAC item resolver.

### 2026-04-26 (Win) — Faz 2 PR-7: Change-Password + Recovery Flow + RBAC İskeleti + Session Binding Flag

**Branch:** `feat/server-auth-recovery` — review/merge bekliyor.

**Üç onaylanmış karar (kullanıcı ile mutabık kalındı):**

1. **Change-password = priv key re-wrap, public_key sabit.** Sebep: `item_shares.e2e_dek_wrapped` satırları kullanıcının public_key'i ile X25519 wrap'lı; pub değişirse hem kendi item'larındaki paylaşımlar hem ona paylaşılan item'lar erişilemez hale gelir. Master parola değişimi rutin bir işlem; veri kaybı kabul edilemez. Bu yüzden client priv key'i eski KEK ile açıp yeni KEK ile yeniden wrap eder, server sadece `private_key_enc + kek_salt + kek_params + version + rotated_at`'i günceller. Recovery'de ise zorunlu full keypair rotation olur (eski master pwd kayıp, eski priv açılamaz, item_shares accessibility kaybedilir — UI prominent uyarı).

2. **Recovery counter login ile paylaşılan.** Tek `users.failed_login_attempts` sütunu — yeni migration yok. Saldırgan login + recovery'i karıştırarak deneyemez (toplamda 10 hak). 10. denemede 30dk lock.

3. **RBAC bu PR'da sadece iskelet.** `RequireRole(allowed...)` middleware (admin bypass + role intersection) + `Permission` tipi + sabitler + `Allows(want)` semantiği. Item/folder DB resolver'lar PR-8'e (Item CRUD ile birlikte SQL'leri test edilebilir hale gelecek).

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/change-password` (Bearer access)
- Body: `{current_master_password, new_master_password, new_private_key_enc, new_kek_salt, new_kek_params}` — `public_key` YOK (sabit kalır).
- Current password verify → fail: `recordLoginFailure` (paylaşılan counter) + 401.
- Tek tx: users (password_hash + argon2_params + counter=0 + locked_until=NULL) + user_keypairs (priv_enc + kek_salt + kek_params + version++ + rotated_at) + `RevokeAllUserSessions('admin')` — tüm cihazlar yeni pwd ile yeniden login.
- Audit `auth.password_changed`. 204 No Content.

`POST /api/v1/auth/recover/init` (rate-limited, no auth)
- Body: `{username, recovery_code}`. Generic 401 (username enumeration kapalı).
- User lookup → unused recovery_codes (array_agg) → linear Argon2id verify (~10 max).
- Match → tek tx: code'u `used_at + used_ip` ile işaretle + `RevokeAllUserSessions('recovery')` + commit. Sonra `auth.PurposeRecovery` tmp_token (15dk).
- Audit `auth.recover` (step=init). Mismatch → `recordLoginFailure` + `auth.recover_fail`.

`POST /api/v1/auth/recover/complete` (Bearer tmp_token, purpose=recovery)
- Body: `{new_master_password, public_key (32B, YENİ), new_private_key_enc, new_kek_salt, new_kek_params}`.
- Tek tx: users güncelle (status='active' geri set) + user_keypairs FULL rotate (yeni pub + priv_enc + kek_*) + `DELETE FROM recovery_codes` + 10 yeni `INSERT recovery_codes` + defansif `RevokeAllUserSessions('recovery')`.
- Audit hem `auth.recover` (step=complete) hem `auth.password_changed` (via=recovery).
- Yanıt: `{recovery_codes: [...10 plain]}` — tek seferlik.

**Yeni middleware (`internal/httpapi/middleware_rbac.go`):**

| Tip / Fonksiyon | Açıklama |
|---|---|
| `Permission` (string alias) | `PermissionNone/Read/Write` — SQL CHECK ile lowercase uyumlu |
| `Permission.Allows(want)` | Write ⇒ Write only; Read ⇒ Read or Write satisfied |
| `RoleAdmin / RoleWrite / RoleRead` | Migration 00003 seed mirror |
| `RequireRole(allowed ...)` | chi middleware: admin bypass, otherwise claims.Roles ∩ allowed > 0 |
| `hasRole(claims, role)` | private helper |
| `writeMiddlewareForbidden` | 403 JSON envelope |

**Session binding flag (`auth_refresh.go` ek):**
- `auth.SessionRow` artık `UserAgent *string` + `IPAddress *string` (lookup sırasında `host(ip_address)::text`).
- `bindingChanged(row, currentIP, currentUA)` — nil-or-empty stored = match (no flag).
- Refresh handler: drift varsa `audit.ActionAuthSessionBindingChanged` (yeni constant) yazılır, blok yok.

**Yeni audit constants:**
- `ActionAuthSessionBindingChanged = "auth.session_binding_changed"`

**Router wire:**
- `/auth/recover/init` → brute RL altında (5 burst, sustained 1/12s).
- `/auth/recover/complete` → tmp-token gated, RL yok (token ömrü kısa zaten).
- `/auth/change-password` → access token gated, RL yok (saldırı için zaten geçerli token gerek).

**Tests (~24 yeni case, toplam 150 PASS):**
- `httpapi/middleware_rbac_test.go`: Permission.Allows matrix (6 case) + RequireRole NoClaims/AdminBypass/AllowedIntersect/NotInSet/EmptyClaims + hasRole 3 case
- `httpapi/auth_refresh_test.go`: bindingChanged BothMatch/IPMismatch/UAMismatch/NilStored/EmptyStored
- `httpapi/auth_change_password_test.go`: validateChangePassword 6 case (OK + 5 invalid)
- `httpapi/auth_recover_test.go`: validateRecoverComplete 6 case (OK + 5 invalid)

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 150 case PASS (önceki 126 + 24 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-8 — Faz 2 son PR):**
- Folder CRUD
- Item CRUD (metadata envelope + secret client-provided)
- Item share + folder_permissions
- `ResolveItemPermission(ctx, db, userID, itemID)` + `ResolveFolderPermission` (recursive ancestor walk SQL)
- Item relationships API
- WebSocket hub `/ws`

**Sıradaki:** PR-8 — Faz 2 son PR. Item CRUD + folder permissions effective resolver.

### 2026-04-26 (Win) — Faz 2 PR-6: Login + Refresh Rotation + Logout(-all) + Rate Limit + Lockout

**Branch:** `feat/server-auth-session` — review/merge bekliyor.

**Plan B genişletmesi:** PR-5 sonrası kalan auth çalışmasını **2'ye böldük** — PR-6 (session lifecycle) + PR-7 (change-password + recovery + RBAC). PR-6 single review unit olarak ~1100 LOC; PR-7'ye kadar geçen sürede session akışları test edilebilir hale geldi.

**Karar: tek-adım login.** `docs/auth-flow.md §3` `{username, password, totp_code}`'u tek body'de istiyor. MFA-bridge token (`mfa-required` purpose) eklemeyi düşünmüştüm, vazgeçtim — auth-flow.md'ye uyalım, fail mesajı zaten generic (oracle yok), 1 round-trip yeterli.

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/login`
- Body: `{username, master_password, totp_code}`. Generic 401 invalid_credentials her başarısız faktörde.
- Lookup user (lowercased username). Status check ('disabled' → 403, 'pending_totp' → 403 account_pending_totp, locked → 403 account_locked).
- Password verify (Argon2id, salt jsonb içinden `salt_b64`'ten). Fail → `recordLoginFailure` (counter++, 10'da lock 30dk).
- TOTP verify (envelope decrypt). Fail → counter++.
- Tüm faktörler OK: tx içinde `recordLoginSuccess` (counter=0, last_login_at=now) + `auth.CreateSession` + `fetchUserRoles` (array_agg) + commit. Access JWT (15dk, sessionID + roles) + opaque refresh (32B hex, 7g).
- Audit `auth.login` / `auth.login_fail` (reason: user_not_found / pending_totp / disabled / locked / wrong_password / wrong_totp).

`POST /api/v1/auth/refresh`
- Body: `{refresh_token}`. SHA-256 hash → sessions lookup.
- **Reuse detection:** Eğer matching row revoked_at IS NOT NULL ise → `RevokeAllUserSessions(reason='reuse_detected')` + `auth.refresh_reuse_detected` audit + 401.
- Expired check: row.ExpiresAt < now → 401 (cleanup cron 'expired' reason'la sweepleyecek).
- Happy path: tx içinde `RevokeSession(old_id, 'rotation')` + yeni session + audit `auth.refresh` (rotated_from kayıtlı). Yeni access + refresh dönülür.

`POST /api/v1/auth/logout` (Bearer access)
- `RevokeSession(claims.ID, 'logout')`. Idempotent (where revoked_at IS NULL). Audit `auth.logout`. 204 No Content.

`POST /api/v1/auth/logout-all` (Bearer access)
- `RevokeAllUserSessions(claims.Subject, 'logout_all')`. Audit `auth.logout_all`. 204 No Content.

**Yeni `internal/auth/`:**

| Dosya | İçerik |
|-------|--------|
| `lockout.go` | `MaxFailedLoginAttempts=10`, `LockoutDuration=30m`, `IsLocked(*time.Time)` (nil/zero/past = false; future = true, nowFn-pinnable) |
| `session.go` | `RevokeReason*` 7 sabit (CHECK constraint mirror), `SessionRow{ID,UserID,ExpiresAt,RevokedAt,RevokeReason}.IsActive(now)`, `DBExec` interface (Pool + Tx satisfies), `CreateSession`, `LookupSessionByRefreshHash`, `RevokeSession`, `RevokeAllUserSessions`, `TouchSession` |

**Yeni `internal/httpapi/`:**

| Dosya | İçerik |
|-------|--------|
| `auth_login.go` | `Login` handler + `userLoginRow` + `fetchUserForLogin/TOTPSecret/UserRoles` + `recordLoginFailure/Success` (CASE-based atomic counter+lock) + `extractSaltFromParams` |
| `auth_refresh.go` | `Refresh` handler + reuse detection + rotation tx |
| `auth_logout.go` | `Logout` + `LogoutAll` + `requireAccessToken` inline helper |
| `middleware_authn.go` | `RequireAccessToken(signer)` chi middleware → claims context'e koyar; `ClaimsFromContext` accessor; `CtxKeyClaims AuthContextKey` |
| `middleware_ratelimit.go` | `IPRateLimiter` (token bucket per-IP, sweep idle buckets); `Middleware` 429 + Retry-After header; `clientIP` (strip port post-RealIP) |

**`error.go`:** `writeInvalidCreds(w, logger, cause)` — kanonik 401 response (Türkçe generic msg).

**Router wire:**
- `/auth/login`, `/auth/refresh`, `/auth/totp/verify`: brute-force RL (5 burst, sustained 1/12s = ~5/min) — auth-flow.md §"Rate limit"'in (5/15dk) tighter sliding-window approximation.
- `/auth/logout`, `/auth/logout-all`: handler içinde `requireAccessToken` inline (audit log için missing-token vakası). Middleware versiyon ileride item endpoint'lerinde kullanılacak.

**Yeni dependency:**
- `golang.org/x/time v0.3.0` indirect → direct (rate.Limiter için)

**Tests (~40 yeni case, toplam 126 PASS):**
- `auth/lockout_test.go`: nil/zero/past/future + nowFn pin + policy constants
- `auth/session_test.go`: `IsActive` 3 case + `validRevokeReason` whitelist + nullables
- `httpapi/middleware_authn_test.go`: NoAuth / BearerPrefixMissing / BadToken / WrongPurpose (tmp token reddedildi) / HappyPath (claims ctx'te) / EmptyCtx
- `httpapi/middleware_ratelimit_test.go`: BurstAllowed / OverBurst429 / PerIPSeparation / RetryAfterHeader / clientIP 3 case
- `httpapi/auth_login_test.go`: `extractSaltFromParams` 4 case + `ptrStringOrEmpty`

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 126 case PASS (önceki 86 + ~40 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-7+):**
- `/auth/change-password` (password verify + new keypair + revoke all sessions)
- `/auth/recover/{init,complete}` (recovery code → tmp_token → new keypair, eski wrap'lı item_shares kaybedilir)
- RBAC middleware (`requireRole`, `requirePermission(folder|item)`)
- Session binding flag (UA/IP değişimi audit)
- WebSocket `/ws` access token gate

**Sıradaki:** PR-7 — change-password + recovery flow + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Faz 2 PR-5: Auth Primitives + Register + TOTP Enroll/Verify

**Branch:** `feat/server-auth-primitives` — review/merge bekliyor.

**Plan B (3 PR'a böldük):** Tek dev'li Faz 2 auth çalışmasını incremental review için 3 PR'a böldük:
- **PR-5 (bu):** Master key bootstrap + auth primitives (Argon2 wrapper, TOTP, JWT, refresh, recovery) + audit helper + Register + TOTP enroll/verify
- **PR-6 (sıradaki):** Login + refresh rotation + logout(-all) + change-password + recovery flow + RBAC middleware iskeleti
- **PR-7:** Item CRUD + folder permissions enforcement (Faz 2 sonu)

**Yeni: `server/internal/auth/` (~600 LOC + ~400 LOC test)**

| Dosya | Sorumluluk |
|-------|-----------|
| `keyloader.go` | `BootstrapMasterKey(ctx, db, key)` — fingerprint match (SHA-256), ilk boot v=1 insert, sonraki boot doğrulama |
| `password.go` | `HashPassword(plaintext)` + `VerifyPassword` — `crypto.HashPassword` üstüne ince persistance wrapper, `Argon2Params` JSON serialization |
| `totp.go` | RFC 6238 SHA-1 6-digit 30s ±1 skew; `GenerateTOTP(issuer, account)` → otpauth_uri + base32 secret; `VerifyTOTP(secret, code)` |
| `jwt.go` | HS256 `JWTSigner`; `IssueAccess` (15dk, purpose=access, sessionID + roles) + `IssueTmp` (15dk, purpose=totp-enroll/recovery) + `Parse(token, expectedPurpose)` |
| `refresh.go` | Opaque token: 32B random hex + SHA-256 hash + 7d TTL — DB'ye sadece hash kaydedilir |
| `recovery.go` | 10 kod × 8 hex byte (16 char); blob = `salt(16) ‖ argon2id_hash(32)`, constant-time verify |
| `service.go` | DI bundle: DB pool + Master cipher + MasterKey state + JWTSigner + SearchKey + IssuerName |

**Yeni: `server/internal/audit/` (~120 LOC)**
- `Writer.Write(ctx, Entry)` — best-effort INSERT INTO audit_log
- 12 Action konstantı: `auth.register`, `auth.totp_init`, `auth.totp_verified`, `auth.login`, `auth.login_fail`, `auth.logout`, `auth.logout_all`, `auth.refresh`, `auth.refresh_reuse_detected`, `auth.password_changed`, `auth.recover`, `auth.recover_fail`
- 3 Resource konstantı: `user`, `session`, `item`
- nullUUID/nullString/nullAddr helpers — empty → SQL NULL

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/register`
- Validasyon: username regex `^[a-zA-Z0-9._-]{3,64}$`, RFC 5322 email, password ≥12 char, public_key tam 32B
- 2-table tx: `INSERT users (status='pending_totp')` + `INSERT user_keypairs`
- `argon2_params` jsonb persist
- Audit `auth.register`
- Yanıt: `{user_id, tmp_token}` (purpose=totp-enroll, 15dk)

`POST /api/v1/auth/totp/init`
- Auth: bearer tmp_token (purpose=totp-enroll)
- Yeni 20B secret üret → master cipher Seal (AAD=`totp_secrets:{user_id}:secret_enc`)
- UPSERT `totp_secrets` (verified=false) — idempotent (yeniden çağrı eski secret'ı yenilemiş olur)
- Audit `auth.totp_init`
- Yanıt: `{otpauth_uri, secret_base32}`

`POST /api/v1/auth/totp/verify`
- Auth: bearer tmp_token (purpose=totp-enroll)
- Encrypted secret fetch → master cipher Open → `VerifyTOTP(secret, code)` (±1 window skew)
- 3-stmt tx: `UPDATE totp_secrets SET verified=true` + `UPDATE users SET status='active'` + 10× `INSERT INTO recovery_codes`
- Audit `auth.totp_verified`
- Yanıt: `{recovery_codes: [...10 plain]}` — **plaintext sadece bu yanıtta görünür**, sonra DB'de hash-only

**Shared: `internal/httpapi/error.go`**
- `ErrorResponse` (Code/Message/Details) — OpenAPI `Error` schema ile uyumlu
- 11 ErrCode konstantı (bad_request, unauthorized, invalid_credentials, invalid_mfa, invalid_code, invalid_token, account_locked, account_pending_totp, rate_limited, conflict, internal_error)
- `writeError(w, logger, status, code, userMessage, cause)` — userMessage Türkçe, cause sadece log'a (5xx için warn)
- `decodeJSON(w, r, logger, dst)` — 1 MiB body cap + DisallowUnknownFields

**Wire: `cmd/api/main.go`**
- Master key 32B kontrol → `auth.BootstrapMasterKey` → `auth.New(ServiceConfig{...})` → `audit.NewWriter(pool)` → `httpapi.AuthHandlers{Service, Audit, Logger}`
- Router `Deps.Auth != nil` ise `/api/v1/auth/{register, totp/init, totp/verify}` mount eder

**Config: `internal/config/config.go`**
- `MasterKey []byte` + `JWTSecret []byte` alanları
- `decodeMasterKey(b64)` — base64.StdEncoding 32B
- `RequireSecrets()` — secret'lar boşsa fail-fast (production safety)

**Test sayısı:** Yeni 18 unit test (`auth/{password,jwt,totp,refresh,recovery}_test.go` + `httpapi/error_test.go`). Tüm paketlerde toplam **86 unit test** (önceki 68 + 18 yeni).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues (gosec G101 false positive `nolint` ile kapatıldı — `ErrCodeInvalidCreds` error-code identifier, secret değil)

**Bilinçli kapsam dışı (PR-6+):**
- `/auth/login` (password verify + TOTP step + session create + access+refresh issue)
- `/auth/refresh` (rotation + reuse detection)
- `/auth/logout`, `/auth/logout-all`
- `/auth/change-password`
- `/auth/recover/{init,complete}` (recovery code → new keypair)
- RBAC middleware (`requireRole`, `requirePermission`)
- Item CRUD (PR-7)

**Sıradaki:** PR-6 — login/refresh/logout/change-password/recovery + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Faz 2 PR-4: Crypto Package

**Branch:** `feat/server-crypto` — review/merge bekliyor.

**Yeni: `server/internal/crypto/` (~520 LOC + ~700 LOC test)**

| Dosya | Sorumluluk |
|-------|-----------|
| `doc.go` | Threat model, koruyduklar/koruyamadıkları, paket sınırları |
| `format.go` | Versionlu blob layout `[v][alg][nonce][ct+tag]` + AAD helpers + RandomBytes |
| `aesgcm.go` | `Cipher` (AES-256-GCM Seal/Open) — random nonce, AAD bound, error-wrapping |
| `envelope.go` | `GenerateDEK()` 32B + ADR-0004 §6 envelope kullanım örneği doc |
| `argon2.go` | Argon2id `HashPassword`, `VerifyPassword` (constant-time), `DeriveKey` (KEK), `Argon2Params.Validate` |
| `sealedbox.go` | X25519 sealed-box: ECDH + HKDF-SHA256 + AES-256-GCM (NaCl crypto_box_seal pattern, anonymous-sender) |
| `searchhash.go` | `DeriveSearchKey` (HKDF) + `SearchHash` (HMAC-SHA256, lowercase, 16-byte truncated) |

**Algoritma uyumluluğu (ADR-0004):**
- AES-256-GCM (12B nonce, 16B tag, AEAD authenticated)
- Argon2id (default t=3, m=64MiB, p=4, salt 16B, key 32B)
- X25519 (`crypto/ecdh`) + HKDF-SHA256 (`golang.org/x/crypto/hkdf`)
- HMAC-SHA256 (truncate-to-128-bit) for searchable encryption

**Tehdit modeli güvenceleri (testlerle doğrulandı):**
- ✓ Wrong-key cross access → fail
- ✓ Wrong-AAD substitution attack → fail
- ✓ Tampered ciphertext (1 bit flip) → fail
- ✓ Algorithm-byte mismatch → fail
- ✓ Sealed-box: yanlış alıcı priv ile open → fail
- ✓ Argon2 KAT: aynı (password, salt, params) → byte-identical
- ✓ Constant-time password compare (`subtle.ConstantTimeCompare`)

**Test sayısı:** 42 unit test (crypto paketi). Tüm paketlerde toplam **68 unit test** (önceki 26 + 42 yeni).

**Yeni dependency:**
- `golang.org/x/crypto v0.17.0` (zaten indirect idi pgx üzerinden; argon2 + hkdf için direct'e geçti)

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 68 unit pass (cache hit'leri dahil)
- `gofmt -l .` clean
- `golangci-lint run ./...` 0 issues

**Bilinçli kapsam dışı (sonraki PR'larda):**
- Master key loader (KMS / k8s Secret okuma + master_keys tablo entegrasyonu) → PR-5'te `internal/auth` ile birlikte
- sqlc query'leri (auth + items) → PR-5+
- Crypto kullanan endpoint'ler (register/login) → PR-5

**Sıradaki:** PR-5 — auth endpoints (register, TOTP enroll/verify, login, refresh, logout, change-password, recovery) + master key bootstrap + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Mac M4 paused, PR-3 merged, tracking sync

- **PR-3 merged** (commit `cf2b63c`, PR #4) — 12 migration + testcontainers integration test main'de.
- **Mac M4 ⏸ paused** — kullanıcı şimdilik tüm geliştirmeyi Win'den yürütüyor. Mac yeniden devreye alınırsa bilgi verilecek. RULES.md'deki "Çift makine workflow" hâlâ geçerli olarak kayıtlı (Mac dönerse aynı pattern), ama mevcut "deploy direct to main" pattern'i şu an Win'de yok — geliştirme tamamen PR akışı.
- Bu commit tracking MD'leri PR-3 merge sonrası state'e + Mac pause notu ile sync ediyor.
- **Bir sonraki:** PR-4 — `internal/crypto` package (envelope encrypt/decrypt + Argon2id + X25519 sealed-box + searchable HMAC + known-answer tests).

### 2026-04-25 (Win) — Faz 2 PR-3: Migration'lar + Integration Test

**Branch:** `feat/server-migrations` — review/merge bekliyor.

**12 yeni migration** (dependency order):
- `00006_master_keys` — envelope encryption hierarchy root, single-active partial index
- `00007_user_keypairs` — X25519 keypair, KEK salt + Argon2id params
- `00008_totp_secrets` — RFC 6238, server-side envelope, verified consistency check
- `00009_recovery_codes` — Argon2id-hashed 10/user, partial index unused
- `00010_item_types` + 8 seed (server, url, database, ssh_key, certificate, cloud_credential, note, generic)
- `00011_field_definitions` + 30 seed (hostname, ip_address, password, environment enum, criticality enum, ...)
- `00012_folders` — tree (parent_id self-ref), name_search HMAC, updated_at trigger
- `00013_folder_permissions` — 3-katmanlı RBAC katmanı, inherit_to_children, partial index
- `00014_items` — UUID v7 client-gen, external_source jsonb (Vault hazır), partial index external_type
- `00015_item_fields` — field_definition_id FK, value_enc nullable (external_source bypass), unique (item, def)
- `00016_item_shares` — per-user wrapped DEK, partial indexes active
- `00017_item_relationships` — 5 edge type, composite PK, self-loop CHECK

**Integration test framework (testcontainers-go):**
- `internal/db/migrations_integration_test.go` (build tag `integration`)
- Postgres 16 container — fresh DB
- Phase 1: `goose up` (tüm 17 migration)
- Phase 2: `goose down to 0` (geri çevirme)
- Phase 3: `goose up` tekrar (idempotency)
- Seed validation: 3 roles, 8 item_types, ≥25 field_definitions
- Spot-check: hostname/environment/criticality keys + enum allowed_values
- 5 dakika global timeout, 60sn container start timeout

**CI yeni job: `server-integration`**
- `runs-on: ubuntu-latest`, Docker hazır
- `needs: [server]` — unit testler önce yeşil olmalı
- Go 1.23 (golangci-lint binary uyumluluğu için pin'lendi)
- `go test -tags=integration -timeout=10m ./internal/db/...`

**Makefile:**
- `make test-integration` hedefi eklendi

**sqlc queries (minimal):**
- `field_definitions.sql` — List, GetByKey, GetByID, Create
- `item_types.sql` — List, GetByKey, GetByID, Create
- (item CRUD ve auth query'leri PR-4+'da)

**Yeni Go deps:**
- `github.com/testcontainers/testcontainers-go v0.30.0` (test-only)
- `github.com/testcontainers/testcontainers-go/modules/postgres v0.30.0`
- `github.com/pressly/goose/v3 v3.22.0`

`go.mod` direktifi `go 1.22` korundu (testcontainers v0.30.0 + goose v3.22.0 uyumlu).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ (28 unit test, integration tag yok)
- `gofmt -l .` clean
- `golangci-lint run ./...` 0 issues
- Integration test (Docker yokken) lokal'de çalışmaz; CI'da koşacak

**Mac tarafı etkisi (merge sonrası):**
- Docker build → GHCR yeni image (12 yeni migration embed'li)
- ArgoCD auto-sync → api Deployment image refresh
- Init container yeni migration'ları otomatik uygular
- `kubectl logs envanter-api-* -c migrate` ile doğrulanır

### 2026-04-25 (Win) — Faz 2 PR-2: DB layer + chi router

**Branch:** `feat/server-db-chi` — review/merge bekliyor.

**Önkoşul:** Win'de Go 1.26.2 kuruldu (`C:\Program Files\Go\`).

**İçerik:**

- **`internal/db`** (yeni) — pgx v5 `pgxpool` wrapper:
  - `Config` struct: URL, MaxConns, MinConns, HealthCheckInterval
  - `Validate()`: URL boş, min<0, max<min, üçü için error mesajları
  - `New(ctx, cfg)`: parse → pool yarat → ilk Ping (5sn timeout) → fail fast davranışı
  - 5 unit test (config validation; live DB testleri PR-3+'da testcontainers-go ile)

- **`internal/httpapi`** (genişletildi) — chi router + middleware stack + handlers:
  - `NewRouter(Deps)` chi router döner; 6 middleware sırası: RequestID → echoRequestIDHeader (yeni helper) → RealIP → slogRequestLogger → Recoverer → Timeout(30s)
  - `slogRequestLogger`: her request için tek satır JSON log; **/healthz ve /readyz log spam'i için filtrelenir** (k8s probe'ları sürekli çağırır)
  - `DBPinger` interface — pgxpool.Pool satisfies; testlerde fake injection
  - `/healthz`: liveness probe, sadece process alive (200 OK)
  - `/readyz`: readiness probe, **2sn timeout ile DB Ping**; fail → 503 + log warn
  - 6 test: /healthz 200, /readyz DB OK 200, /readyz DB down 503, X-Request-Id header echo, 404 unknown path, 405 POST /healthz

- **`cmd/api/main.go`** (refactor) — config + logging + db pool + chi router birlikte wire edildi. Graceful shutdown korundu.

- **`server/go.mod` + `go.sum`** — yeni deps: `github.com/go-chi/chi/v5 v5.2.5`, `github.com/jackc/pgx/v5 v5.9.2` + indirect (puddle, pgpassfile, pgservicefile, x/sync, x/text). `go 1.25.0` directive (pgx v5.9.2 minimum).

- **`go.work`** — `go 1.22` → `go 1.25.0` (workspace go directive must be ≥ module).

- **`.github/workflows/ci.yml`** — Go matrix `1.22` → `stable` (setup-go'nun son stable Go'su; pgx 1.25+ gerekli).

**Lokal doğrulama (Win, Go 1.26.2):**
- `go build ./...` ✅
- `go vet ./...` ✅
- `go test ./...` ✅ — 28 test, 0 fail (config 9 + db 5 + httpapi 6 + logging 8)
- `gofmt -l .` boş (CRLF→LF auto-fix sonrası)
- Binary boyut: 13.1 MB (server/cmd/api)

**Bilinçli kapsam dışı (PR-3+'a bırakıldı):**
- testcontainers-go ile DB integration test (gerçek migration up/down)
- Auth endpoints (Argon2id + TOTP + JWT)
- Faz 2 ek migration'lar (00006-00017)
- Crypto package (`internal/crypto`)
- WebSocket hub

### 2026-04-25 (Win catch-up) — Tracking sync sonrası BFG history purge

Mac M4'te yapılan kapsamlı çalışmalardan sonra Win local repo'su `git reset --hard origin/main` ile remote'a hizalandı (BFG history purge'u sonrası tüm commit hash'leri yeniden yazılmıştı: `b35a46c → 21bd3df → 242cf40 → cb87259`, vs.).

**Mac'in tamamladıkları (özet):**
- PR-1 merge (`cb87259`)
- CI optimizasyonu: 1+ saat → 5dk
- Secret rotation + history purge (`daa48d0` + BFG)
- DB migration init container (`9ea420b`) — `goose` binary embed + `/migrations` copy + initContainers entry
- Server Dockerfile native cross-compile (`a89ac83` + `3bbb077` + `89be3c2`) — QEMU yok, ~8dk multi-arch
- Tag'ler: `v0.1.0-dev`, `v0.1.1-dev`
- Cluster doğrulama: tüm pod 1/1 Running, /healthz 200 OK

**Win catch-up commit'i (bu):**
- PROGRESS.md "Mevcut Durum" + Faz Durumu tablosu güncellendi (PR-1 merged, secret bloker resolved, Faz 5 PARTIAL detayı genişletildi)
- TODO.md "Aktif" bölümü ve kritik secret rotation [x] işaretleri tamamlandı
- ADR-0008 "Plaintext Secret'lar" bölümüne RESOLVED notu
- CLAUDE.md kapsam bölümüne migration init container eklendi
- Bloker / Risk listesi sadeleşti

### 2026-04-25 (Mac, geç saat) — CI Docker job optimizasyonu

PR-1 merge sonrası docker job 1+ saat sürdü (QEMU multi-arch). Çözüm:
- main push → amd64-only (~5dk): QEMU emülasyon yok, hızlı feedback
- `v*` tag push → multi-arch amd64+arm64 (release distribution için, M4 uyumlu)
- `:main-<sha7>` tag eklendi reproducibility için (`:latest` anti-pattern kısmen çözüldü, ADR-0008 notu)
- Cache scope per image (`scope=api` / `scope=web`) — bir image değişince diğerinin cache'i geçerliliğini koruyor
- `on.push.tags: ['v*']` eklendi — tag push'larda CI tetikleniyor

### 2026-04-25 (Mac M4) — Git history purge (BFG)

- BFG 1.15.0 ile `deploy/k8s/secret.yaml` tüm git history'den silindi
- Bare mirror clone → BFG → `git reflog expire` + `git gc --prune=now --aggressive` → force push
- Remote (GitHub) doğrulandı: eski commit'lerde artık `secret.yaml` içeriği yok
- Lokal repo da temizlendi (gc sonrası `git log --all --full-history -- secret.yaml` boş döndü)
- Win Claude session'ı `git pull` / re-clone yapmalı (hash'ler değişti)

### 2026-04-25 (Mac M4) — Secret rotation + .gitignore

- `deploy/k8s/secret.yaml` git tracking'den çıkarıldı (`git rm --cached`)
- `.gitignore`'a `deploy/k8s/secret.yaml` ve `deploy/k8s/*-secret.yaml` eklendi
- `deploy/k8s/secret.yaml.example` placeholder template commit'lendi
- Yeni `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD`, `ENVANTER_DB_URL` üretildi (32/32/24 byte random base64)
- Cluster'da `kubectl create secret generic envanter-secret` ile apply edildi
- Postgres PVC sıfırlandı (test ortamı, fresh start) → StatefulSet + API pod'ları restart
- `configmap.yaml`'dan plaintext `ENVANTER_DB_URL` kaldırıldı; parça parça env'lere bölündü (`ENVANTER_DB_HOST/PORT/NAME/USER/SSLMODE`)
- `ENVANTER_DB_URL` artık Secret'tan geliyor (`kubectl create secret` ile)
- *Hâlâ TODO:* Git history'den eski secret'ları purge (BFG / git filter-repo) — ayrı task
- *Hâlâ TODO:* Sealed Secrets / External Secrets Operator adoption (Faz 5)

### 2026-04-25 — Cross-machine deploy work (Mac M4, paralel Claude session) — backfill

Bu entry, **Mac M4 üzerinde paralel olarak yapılan deploy çalışmasının** geriye dönük dokümantasyonu (RULES.md tracking discipline kuralı için). Çalışmayı yapan: Burak Haşlaman + Claude Sonnet 4.6 (Mac session).

**4 commit (sıralı):**

| Commit | Açıklama |
|--------|---------|
| `9d8894f` | feat: add Dockerfiles, k8s manifests, and GHCR CI pipeline |
| `48920ac` | fix: allow multi-document YAML in pre-commit + add ArgoCD Application |
| `002a9e3` | fix: add imagePullSecrets for GHCR private registry |
| `38c784e` | fix: build multi-platform images (amd64 + arm64) for M4 compatibility |

**Eklenen / değişen:**

- **`server/Dockerfile`** — Go multi-stage (golang:1.22-alpine → scratch); CGO disabled, ~20MB image
- **`web/Dockerfile`** + **`web/nginx.conf`** — Vite build → nginx; `/api` proxy + `/ws` WebSocket + SPA fallback
- **`deploy/k8s/`** (9 dosya) — namespace, configmap, secret, postgres (StatefulSet+PVC), api, web (NodePort 30830), adminer, mailhog, argocd-app
- **`.github/workflows/ci.yml`** — yeni `docker` job (push to main only): GHCR login + buildx + multi-arch push (amd64 + arm64); cache=gha
- **`.pre-commit-config.yaml`** — `check-yaml` için `--allow-multiple-documents` (k8s manifest'ler `---` içerir)
- **ADR-0008 (bu commit'te)** — Containerization + raw k8s + GHCR + ArgoCD GitOps. ADR-0001'in Helm tercihinden farklılaşma.

**Pattern:**
- main'e push = CI → Docker images (api, web) GHCR'a push → ArgoCD detect (polling) → envanter namespace sync. Tam GitOps.
- Multi-arch sayesinde Mac M4'te `kubectl run` veya kind/k3d ile yerel test sorunsuz.

**⚠️ Kritik bulgular ve yapılacaklar:**

1. **`deploy/k8s/secret.yaml` plaintext secret içeriyor** — `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD` repo'da görünür. Repo private olsa bile sektör pratiği ihlali. **Acil aksiyonlar:**
   - Master key + JWT secret rotate (yeni rastgele 32B üret)
   - `secret.yaml`'ı `.gitignore`'a ekle
   - `secret.yaml.example` placeholder commit
   - Git history'den eski secret'ları purge (`git filter-repo` veya BFG)
   - Sealed Secrets / External Secrets / SOPS adoption (Faz 5)
2. `:latest` tag — git SHA / semver tag pin'lemesi gerekir (Faz 5)
3. Resource limits, HPA, Ingress, TLS, NetworkPolicy, Pod Security Standards eksik — Faz 5'e taşındı
4. DB migration init container yok — api Deployment'ına eklenmeli (Faz 2 PR-2 veya PR-3'te)

**Gözlem:** Pre-commit'in `gitleaks` hook'u secret leak'i yakalayamadı (k8s YAML secret kategorize etmedi). `gitleaks` config'ine custom rule eklenmesi düşünülecek.

### 2026-04-24 — Proje başlangıcı + Faz 0 tamamlandı
- Gereksinimler ve hedef netleşti (envanter app, DevOps/SRE takımı için, KeePassXC replacement).
- Tech stack kararı alındı: Go + Tauri + PostgreSQL 16 + monorepo (ADR-0001).
- Güvenlik modeli **hibrit** olarak belirlendi (ADR-0002):
  - Metadata → server-side envelope encryption
  - Secret field'lar → client-side E2E
  - Audit log → server-side plaintext
- Monorepo layout kararlaştırıldı (ADR-0003).
- 6 fazlı yol haritası çıkarıldı (tahmini 5-7 hafta).
- İlerleyiş takip dosyaları oluşturuldu: `CLAUDE.md`, `PROGRESS.md`, `RULES.md`, `TODO.md`.
- **Faz 0 kod iskeleti tamamlandı:**
  - Monorepo dizin yapısı (server/, client/, web/, shared/, deploy/, docs/, .github/)
  - Root config: `.gitignore`, `.editorconfig`, `README.md`, `LICENSE`, `Makefile`, `.env.example`, `go.work`
  - Go server: `cmd/api/main.go` (healthz endpoint, graceful shutdown), 7 internal paketi için doc.go
  - Docker Compose: Postgres 16 + Adminer + Mailhog
  - Linting: `.golangci.yml` + `.pre-commit-config.yaml` (gitleaks dahil secret tarama)
  - CI: `.github/workflows/ci.yml` — server job (gofmt + go mod tidy + golangci-lint + build + test -race) + pre-commit job
  - 3 ADR: tech-stack, security-model, repo-layout
  - Web scaffold: Vite + React 18 + TS + ESLint + Prettier
  - Tauri scaffold: Cargo.toml + tauri.conf.json + main.rs + lib.rs + Vite+React frontend
  - `docs/smoke-test.md` kullanıcı için doğrulama kılavuzu
- **Not:** Lokal dev ortamında Go/Node/Rust/Docker kurulu değil — smoke test user'ın kendi makinesinde yapılacak.

### 2026-04-24 (2. iş günü) — Faz 1 tasarım + implementasyon
- Repo lokal git'e alındı (`Desktop/Repos/Envanter_App`), ilk commit `c65a4be`.
- **Faz 1 — Veri modeli + kripto tasarımı tamamlandı.** Sıralı iş:
  1. ER diyagramı (Mermaid, 11 tablo). `users`, `user_keypairs`, `totp_secrets`, `recovery_codes`, `sessions`, `roles`, `user_roles`, `master_keys`, `folders`, `items`, `item_fields`, `item_shares`, `audit_log`.
  2. ADR-0004 — Şifreleme detayları: AES-256-GCM (nonce 12B, tag 16B, versiyonlu blob formatı), Argon2id (t=3, m=64MiB, p=4), X25519 sealed-box key wrap, HMAC-SHA256 search. Key hierarchy: KMS/Secret → master_key → server_dek (metadata); user_password → KEK → user_priv → e2e_dek (secrets).
  3. ADR-0005 — `goose` seçildi. SQL-first, embed, review-friendly. Atlas değerlendirildi, ekip tercihinde review-first felsefesine uymuyor.
  4. Auth akış dokümantasyonu — 9 senaryo Mermaid sequence ile. Register + TOTP enroll + login + refresh rotation + auto-lock + logout + password change + recovery + admin reset.
  5. **Review çıktıları (6 karar):**
     - UUID v7 client-üretimli ✓
     - MFA zorunlu; login'de TOTP, unlock'ta sadece master password
     - Recovery code → yeni keypair (solo item kaybı kabul, UI'da prominent uyarı)
     - Auto-lock default 10dk (5/10/15/30 configurable)
     - Searchable encryption HMAC hash — frequency leak kabul
     - Session binding = flag (block değil); token reuse detection → tüm session'lar revoke
  6. 5 migration (`00001` init extensions + `00002` users + `00003` roles + `00004` sessions + `00005` audit_log). pgcrypto, `set_updated_at()` trigger, CHECK constraints, partial index'ler, BRIN index audit_log'da.
  7. OpenAPI 3.1 spec — `shared/api/openapi.yaml`. Health + 10 auth endpoint (register, TOTP init/verify, login, refresh, logout, logout-all, change-password, recover/init, recover/complete).
  8. Code gen pipeline: `sqlc.yaml` + 4 query dosyası (users/sessions/roles/audit_log), `oapi-codegen.yaml`, Makefile `gen`/`gen-sqlc`/`gen-oapi-go`/`gen-oapi-ts`/`gen-check` hedefleri. `tools-install` hedefiyle Go tool'ları pin versiyonlu.

### 2026-04-24 (3. iterasyon) — Faz 1 genişleme: UX + RBAC + Vault tasarımı

Kullanıcı review sırasında ürün için 4 ek boyut tanımladı; hepsi için tasarım kararları alındı, belgeler güncellendi. **SQL migration'ları Faz 2'ye bırakıldı** (sadece admin rolü eklemesi 00003'te).

**Karar özeti:**
- **Objeler arası link** (`item_relationships` tablosu) — 5 edge tipi: `hosted_on`, `accessed_via`, `part_of`, `related_to`, `depends_on`. DevOps topolojisini yansıtır (DB ↔ sunucu, jump server zinciri).
- **Item tipleri** (`item_types` ayrı tablo, enum değil) — admin yeni tip ekleyebilir. 8 seed: server / url / database / ssh_key / certificate / cloud_credential / note / generic. Her tipin `suggested_fields` ve `default_launchers` (Faz 4) metadata'sı var.
- **Merkezi field sözlüğü** (`field_definitions` tablosu) — hostname/host_name drift'ini engeller. Type-to-search autocomplete UI'da. `field_type` içinde `enum` desteği (`allowed_values jsonb`) — `environment` (prod/stage/test/dev/lab) ve `criticality` (critical/high/medium/low) seed'li. `is_secret` artık tanımın parçası (E2E mi envelope mi otomatik).
- **3-katmanlı RBAC** — ADR-0006 §4:
  1. Global rol: `admin` / `write` / `read` (3 rol; admin rolü eklendi, 00003 revize)
  2. Klasör-level ACL: `folder_permissions` tablosu, `inherit_to_children`
  3. Item-level share: mevcut `item_shares`
  - Effective permission hesabı auth-flow.md'de pseudocode olarak.
- **External secret backends** (ADR-0007) — HashiCorp Vault **proxy** modeli:
  - Envanter Vault'tan DB'ye yazmaz, passthrough eder (E2E modeli bozulmaz)
  - `items.external_source jsonb` kolonu path referansı tutar
  - Kubernetes auth (k8s SA → Vault AppRole) MVP; OIDC SSO parking lot
  - Dynamic secrets (15dk kısa ömürlü DB cred) Faz 5+ bonus
  - **Manuel linking only** (MVP) — auto-discovery parking lot
- **Organizational convention** — proje/ortam folder düzeni + `environment` field cross-cutting sorgu için.

**Güncellenen dosyalar (9):**
- `docs/diagrams/er.mmd` — 17 tabloya çıktı (yeni: item_types, field_definitions, folder_permissions, item_relationships; modifiye: items +external_source, item_fields ↔ field_definitions)
- `docs/adr/0006-data-model-extensions.md` — YENİ
- `docs/adr/0007-external-secret-backends.md` — YENİ
- `docs/adr/README.md` — 0006 + 0007 index'e
- `docs/auth-flow.md` — RBAC 3 katman + endpoint matrix genişletildi
- `server/migrations/00003_roles.sql` — admin rolü seed'e
- `CLAUDE.md` — RBAC katmanları + Vault notu
- `PROGRESS.md` — bu entry
- `TODO.md` — Faz 2 migration listesi + Parking Lot güncellendi

### 2026-04-24 (4. iterasyon) — Repo konumu kuralı + tracking disiplini

- Claude-Chat / Repos divergence sorgulandı; yön netleştirildi: **Repos canonical, Claude-Chat legacy/donmuş**.
- `RULES.md`'ye yeni "Repo Konumu ve Tracking Dosyaları" bölümü eklendi:
  - Canonical dizin: `Desktop/Repos/Envanter_App`. Tüm yazılar absolute path ile bu konuma.
  - **Push öncesi zorunlu tracking güncelleme** matrisi (PROGRESS / TODO / CLAUDE / RULES / ADR / ER / OpenAPI). Asıl iş commit'i ile aynı commit'te.
  - Ayrı "docs commit" ANTI-PATTERN sayılır (review yükünü ikiye katlar).
- Bu kural pratikte zaten uygulanıyordu (Faz 1 commit'i bunu izlemişti); şimdi sözleşme yazılı.

## Mimari Kararlar (Özet)

| No | Karar | Durum |
|----|-------|-------|
| 0001 | Tech stack: Go + Tauri + Postgres + monorepo | Kabul (2026-04-24) |
| 0002 | Güvenlik modeli: hibrit (server-side envelope + client-side E2E) | Kabul (2026-04-24) |
| 0003 | Repo layout: monorepo | Kabul (2026-04-24) |
| 0004 | Şifreleme detayları: AES-256-GCM + Argon2id + X25519 + HMAC search | Kabul (2026-04-24) |
| 0005 | Migration tool: goose | Kabul (2026-04-24) |
| 0006 | Veri modeli: item_types, field_definitions, folder_permissions, item_relationships + admin rolü | Kabul (2026-04-24) |
| 0007 | External secret backends: Vault proxy (manuel linking, Faz 5 impl) | Kabul (2026-04-24) |
| 0008 | Containerization + raw k8s + GHCR + ArgoCD (Helm yerine, ADR-0001 deploy satırını değiştirir) | Kabul (2026-04-25) |

## Bloker / Risk / Not

- **2026-04-24:** Win lokal makinede Go, Node, Rust, Docker kurulu değil — CI'a push edilene kadar gerçek build/test verifikasyonu yok. Kullanıcı `docs/smoke-test.md`'deki adımları lokal dev makinesinde çalıştırmalı.
- Tauri iconları (Faz 4'te) eklenmeden `tauri:build` warning verebilir. `tauri:dev` sorunsuz çalışır.
- `go.sum`, `package-lock.json`, `Cargo.lock` henüz yok — ilk `go mod tidy` / `npm install` / `cargo build` komutlarında üretilecek ve commit'lenecek.
- **Faz 1 sonu:** Migration'lar Postgres üzerinde çalıştırılmadı (lokal ortam yok). Kullanıcı `make migrate-up` ile doğrulamalı.
- Code gen henüz çalıştırılmadı; `server/internal/db/sqlcgen/`, `server/internal/httpapi/apigen/`, `web/src/api/schema.gen.ts`, `client/src/api/schema.gen.ts` dosyaları yok. `make gen` ilk kez çalıştırıldığında üretilecek ve commit'lenmeli (CI `make gen-check` ile drift'i yakalar).
- ~~**🚨 KRİTİK 2026-04-25:** `deploy/k8s/secret.yaml` plaintext.~~ **ÇÖZÜLDÜ 2026-04-25 (Mac):** Rotate + `.gitignore` + BFG history purge + `secret.yaml.example` placeholder. Sealed Secrets adoption Faz 5 task'ında.
- ~~**2026-04-25:** PR-1 force-push gerekti.~~ **TAMAM:** PR-1 rebase + merge tamamlandı (`cb87259`).
- **2026-04-25 (akşam):** BFG history purge sonrası tüm commit hash'leri değişti. Win local `git reset --hard origin/main` ile sync edildi. Gelecekte yeni history purge olursa benzer sync gerekir.
