# Yapılacaklar

Son güncelleme: 2026-04-27 (Faz 3 PR-W1 merged, PR-W2 hazır, Mac PR-W3 unlock yaklaşıyor)

TodoWrite ile senkronize çalışır — aktif session'daki live task listesi TodoWrite'tadır, bu dosya kalıcı referanstır.

İşaretler: `[ ]` TODO · `[~]` devam ediyor · `[x]` tamamlandı · `[!]` bloke / user aksiyonu bekliyor · 🚨 kritik

---

## ~~🚨 KRİTİK — Secret Leak~~ ✅ ÇÖZÜLDÜ (2026-04-25)

`deploy/k8s/secret.yaml` plaintext leak'i tamamen kapatıldı. ADR-0008'e ayrıntılı yazılı.

- [x] `ENVANTER_MASTER_KEY` rotate
- [x] `ENVANTER_JWT_SECRET` rotate
- [x] `secret.yaml`'ı `.gitignore`'a ekle
- [x] `secret.yaml.example` placeholder ile yer tutucu commit
- [x] Mac cluster'da `kubectl create secret` ile uygulandı
- [x] Git history'den eski secret'ları purge (BFG, 2026-04-25)
- [ ] **Sealed Secrets / External Secrets Operator adoption** → Faz 5'in part'ı

---

## Aktif: Faz 3 — Admin Web UI (başlıyor 2026-04-26)

**İş bölümü:** Win 5 PR (server + foundation + auth + realtime/polish), Mac Pro 3 PR (admin + inventory ekranlar). Mac token ekonomisi → self-contained ekran PR'ları Mac'e tahsis.

**Hedef:** 5 günde Faz 3 BİTECEK. Bekleme yok, ardışık zincir.

### Server PR'ları (Win)

#### ✅ PR-10: WebSocket hub + admin user mgmt — `feat/server-ws-admin` (REVIEW BEKLIYOR)

- [x] `internal/ws/` paketi: hub + connection + 9 event type sabit + ping/pong + drop-on-overflow
- [x] `GET /api/v1/ws` upgrade endpoint (JWT access, subprotocol `envanter.v1`)
- [x] Hub kendi ctx'i kullanıyor (chi Timeout middleware Hijack uyumsuzluğu çözüldü)
- [x] Router refactor: Timeout artık per-group, `/ws` çıplak
- [x] `Hub.Publish` entegrasyonu: 9 mutate endpoint'i event yayınlıyor (folder + item + share/unshare)
- [x] `internal/httpapi/admin_users.go`: `GET /admin/users` (pagination 50/200), `disable/enable` (revoke all sessions on disable), `role grant/revoke` (self-strip-admin engeli)
- [x] `RequireRole(RoleAdmin)` middleware compose
- [x] 4 yeni audit constant: `admin.user_disabled/enabled/role_granted/revoked`
- [x] `github.com/coder/websocket v1.8.12` direct dep
- [x] ~7 yeni unit test (toplam 181 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

#### ✅ PR-11: Read API + OpenAPI minimal sync — `feat/server-readapi` (REVIEW BEKLIYOR)

- [x] `GET /api/v1/admin/audit-log` — 6 filter param (AND), pagination (50/500), `auditFilter.whereClause` dinamik placeholder builder
- [x] `GET /api/v1/field-definitions` — 30 seed field full list (no pagination; client cache)
- [x] `GET /api/v1/item-types` — 8 seed tip
- [x] `GET /api/v1/users/:id/public-key` — share modal için, 404 if disabled/missing
- [x] `shared/api/openapi.yaml` — info v0.3.0 + 5 yeni tag (detaylı path/schema Faz 3 sonu polish PR'ına ertelendi; Mac elle TS yazıyor)
- [x] ~10 yeni unit test (toplam 191 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean
- [ ] **Faz 3 sonu polish PR (PR-W6 ile)**: tam OpenAPI spec sync + `make gen` ile `web/src/api/schema.gen.ts`

#### ✅ PR-12: /users/me/keypair endpoint — `feat/server-me-keypair` (REVIEW BEKLIYOR)

Mac sorularından doğan ufak server PR'ı (Q4: KEK türetme için keypair fetch).

- [x] `GET /api/v1/users/me/keypair` — caller's user_keypairs row (public_key + private_key_enc + kek_salt + kek_params + version + rotated_at)
- [x] CatalogHandlers'a `GetMyKeypair` metodu (yeni handler struct yok)
- [x] Routing collision kontrolü (`/users/me/keypair` vs `/users/{id}/public-key`) — test ile pin'lendi
- [x] 5 yeni unit test (toplam 196 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### Web PR'ları (Win başlangıç + Mac ekranlar + Win son)

#### ✅ PR-W1: Foundation — `feat/web-foundation` (REVIEW BEKLIYOR)

- [x] `web/src/api/client.ts` — typed fetch + Bearer + refresh-on-401 interceptor + concurrent refresh collapse + auth:logout event
- [x] Token storage: access memory-only, refresh localStorage
- [x] Error mapping: `ApiError(status, code, message, details)` + ErrCode constants + helpers
- [x] Layout: AppShell (TopBar + Sidebar + Outlet) + ThemeProvider (system/light/dark + prefers-color-scheme)
- [x] React Router v6: AuthGate (hydrating splash + redirect /login) + RoleGate (role intersection)
- [x] Tailwind 4 setup (CSS-first, @theme + CSS vars) + shadcn/ui primitives (10 component)
- [x] TanStack Query: QueryClient + queryKeys factory + ReactQueryDevtools (dev only)
- [x] Zustand stores: auth (memory-only kek+priv, Uint8Array zeroize on clear) + ui (theme + sidebar persist)
- [x] Vite config: proxy /api + /ws + `'@'` alias + Vitest jsdom env
- [x] Mac sahası placeholder pages (pages/admin/**, pages/inventory/**)
- [x] CI yeni `web` job: type-check + lint + test + build (`npm install`; lock ileride)
- [x] ~27 yeni Vitest test case (cn, token-storage, errors, client, auth store)

#### ✅ PR-W2: Auth screens — `feat/web-auth` (REVIEW BEKLIYOR)

- [x] `lib/crypto.ts`: hash-wasm Argon2id KEK derive + WebCrypto AES-GCM wrap/unwrap + X25519 keygen + base64 helpers
- [x] `api/auth.ts`: 8 mutation hook (login/logout/logoutAll/changePwd/totpInit/totpVerify/recoverInit/recoverComplete)
- [x] `api/me.ts`: fetchMyKeypair (raw) + useMyKeypairMutation
- [x] Login flow: substep state machine (authenticating → fetching_keypair → deriving_key → unlocking → setSession → navigate)
- [x] TOTP setup wizard: enroll → verify → recovery_codes (3 phase, "ONCE" warning)
- [x] Recovery wizard: init → warn (item_shares kayıp uyarısı) → complete (yeni X25519 + KEK + priv encrypt) → codes (4 phase)
- [x] Change-password dialog: priv re-wrap (public_key SABIT — item_shares korunur) + clear + navigate /login
- [x] AppShell: KeyRound icon → ChangePasswordDialog + Logout server POST + best-effort
- [x] App.tsx route'lar: /login + /totp/setup + /recover (public)
- [x] ~9 yeni Vitest test case (crypto roundtrip + tamper detection)
- [x] **Karar değişikliği:** ADR-0009 `argon2-browser` yerine `hash-wasm` (Vite uyumluluğu, modern API). ADR §3 spirit korunuyor (WASM Argon2id).
- [x] Lokal validation atlandı (Win'de Node yok), CI'a güveniyoruz

#### 🔜 PR-W3: Admin screens — `feat/web-admin` (**Mac**)

- [ ] User list page (`/admin/users`): table + pagination + role badges
- [ ] Role assign/revoke buttons (admin / write / read)
- [ ] Disable/enable toggle
- [ ] Audit log viewer (`/admin/audit-log`): filter (action, user, date) + pagination + JSON details collapse
- [ ] Empty state, loading skeleton, error toast
- [ ] Unit tests (table interaction, filter state)

#### 🔜 PR-W4: Inventory read — `feat/web-inventory-read` (**Mac**)

- [ ] Folder tree component (sol sidebar, recursive expand/collapse)
- [ ] Item list (orta panel): tablo + folder filter + search box (HMAC blind index)
- [ ] Item detail panel (sağ): metadata + fields (decrypted display)
- [ ] Empty/loading states
- [ ] Permission badges per item (read/write)
- [ ] Unit tests (tree expand state, list filtering)

#### 🔜 PR-W5: Inventory write — `feat/web-inventory-write` (**Mac**)

- [ ] Folder create modal (parent picker)
- [ ] Folder rename + delete + drag-drop re-parent (basic)
- [ ] Item create form (item type seçimi + dynamic field rendering by field_definition list)
- [ ] Field tipleri: text / password (toggle visibility) / url / textarea / enum (dropdown)
- [ ] **Client-side encryption:** owner DEK gen + X25519 wrap + field value encrypt (crypto-js veya WebCrypto)
- [ ] Item edit (PATCH semantik — fields replace-all)
- [ ] Item delete confirm
- [ ] Sharing modal: user picker + role select + recipient pub_key fetch + DEK re-wrap
- [ ] Unit tests (form state, encryption flow)

#### 🔜 PR-W6: Realtime + polish — `feat/web-realtime-polish` (Win)

- [ ] WebSocket client (`/ws` connect with access token)
- [ ] Event handlers: folder/item create/update/delete/share → state invalidate / refetch
- [ ] Reconnect logic (exponential backoff)
- [ ] i18n (Türkçe öncelik, EN fallback, react-i18next)
- [ ] Dark mode toggle (localStorage persist)
- [ ] Responsive breakpoints (tablet + mobile sidebar collapse)
- [ ] A11y pass (keyboard nav, aria-labels, focus management)
- [ ] **Faz 3 BİTECEK** — kapanış commit'i

---

## Tamamlanan: Faz 2 — Server MVP (2026-04-26)

### ✅ PR-1: Foundation (config + logging) — MERGED `cb87259`

- [x] `internal/config` — env loader + 9 unit test
- [x] `internal/logging` — slog + secret redaction + 8 unit test
- [x] `cmd/api/main.go` refactor (config + logger wire)
- [x] CI yeşil + merge → main'de canlı
- [x] **DB migration init container** — Mac (paralel, ADR-0008)

### ✅ PR-2: DB layer + chi router — `feat/server-db-chi` (REVIEW/MERGE BEKLIYOR)

**Durum:** Branch push edildi, lokal CI yeşil (28 test, gofmt OK, build OK). GitHub'da PR aç + CI yeşilini bekle + squash merge.

- [x] Go 1.26.2 kuruldu (Win)
- [x] Go deps: `github.com/go-chi/chi/v5 v5.2.5`, `github.com/jackc/pgx/v5 v5.9.2`
- [x] `go.mod` + `go.sum` (`go 1.25.0` directive — pgx v5.9.2 min)
- [x] `go.work` go directive bumped to 1.25.0
- [x] `internal/db` — pgxpool wrapper + Config validation + 5 unit test
- [x] `internal/httpapi/router.go` — chi router + 6 middleware (RequestID, echoRequestIDHeader, RealIP, slogLogger, Recoverer, Timeout)
- [x] `internal/httpapi/health.go` — /healthz (alive), /readyz (DB ping 2sn timeout)
- [x] `cmd/api/main.go` — DB pool + chi router wire
- [x] httpapi router unit testler (httptest, fakeDB) — 6 test
- [x] CI matrix: Go 1.22 → stable (pgx min 1.25)

### ✅ PR-3: Migrations + Integration Test — MERGED `cf2b63c`

- [x] 12 migration: master_keys → item_relationships (dependency-order)
- [x] testcontainers-go integration test (up/down/up + seed validation)
- [x] CI `server-integration` job (Go 1.23, Docker)
- [x] Makefile `test-integration` target
- [x] sqlc queries (minimal): field_definitions + item_types

### ✅ PR-4: Crypto Package — `feat/server-crypto` (REVIEW BEKLIYOR)

- [x] `internal/crypto/format.go` — versioned blob + AAD helpers
- [x] `internal/crypto/aesgcm.go` — AES-256-GCM Cipher (Seal/Open)
- [x] `internal/crypto/envelope.go` — GenerateDEK + envelope flow doc
- [x] `internal/crypto/argon2.go` — HashPassword / VerifyPassword / DeriveKey
- [x] `internal/crypto/sealedbox.go` — X25519 sealed-box (ECDH + HKDF + AES-GCM)
- [x] `internal/crypto/searchhash.go` — HMAC-SHA256 deterministic + HKDF
- [x] `internal/crypto/doc.go` — threat model + sınırlar
- [x] 42 unit test (KAT, AAD substitution, tamper, wrong-key, wrong-recipient)
- [x] `golang.org/x/crypto v0.17.0` direct dependency (argon2 + hkdf)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### ✅ PR-5: Master key bootstrap + auth primitives + Register + TOTP — `feat/server-auth-primitives` (REVIEW BEKLIYOR)

**Plan B:** Faz 2 auth çalışmasını 3 PR'a böldük (PR-5: primitives + register/TOTP, PR-6: login/refresh/logout/change-pwd/recovery + RBAC middleware, PR-7: Item CRUD).

- [x] `internal/config` — `MasterKey` + `JWTSecret` + `RequireSecrets()`
- [x] `internal/auth/keyloader.go` — `BootstrapMasterKey` (fingerprint match)
- [x] `internal/auth/password.go` — Argon2id wrapper + `Argon2Params` JSON
- [x] `internal/auth/totp.go` — RFC 6238 (pquerna/otp), ±1 skew
- [x] `internal/auth/jwt.go` — HS256 signer (access + tmp purposes)
- [x] `internal/auth/refresh.go` — opaque 32B + SHA-256 hash + 7d TTL
- [x] `internal/auth/recovery.go` — 10 codes × 8 hex byte, salt(16)‖hash(32) blob
- [x] `internal/auth/service.go` — DI bundle
- [x] `internal/audit` — Writer + 12 action constants + 3 resource constants
- [x] `internal/httpapi/error.go` — shared ErrorResponse + 11 ErrCode + decodeJSON helper
- [x] `internal/httpapi/auth_register.go` — POST /api/v1/auth/register (2-table tx, audit, tmp_token)
- [x] `internal/httpapi/auth_totp.go` — POST /totp/init + /totp/verify (envelope encrypt secret, recovery codes)
- [x] `cmd/api/main.go` — master key bootstrap → auth.Service → AuthHandlers wire
- [x] 18 yeni unit test
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### ✅ PR-6: Login + refresh rotation + logout(-all) + rate limit + lockout — `feat/server-auth-session` (REVIEW BEKLIYOR)

**Plan B genişletmesi:** Eski PR-6 kapsamını 2'ye böldük (PR-6: session lifecycle, PR-7: change-pwd + recovery + RBAC).

- [x] `internal/auth/lockout.go` — `MaxFailedLoginAttempts=10`, `LockoutDuration=30m`, `IsLocked`
- [x] `internal/auth/session.go` — `SessionRow`, `DBExec` interface, `CreateSession/LookupSessionByRefreshHash/RevokeSession/RevokeAllUserSessions/TouchSession` + 7 RevokeReason sabit
- [x] `internal/httpapi/auth_login.go` — tek-adım login (pwd + TOTP), atomic counter+lock CASE SQL, generic 401
- [x] `internal/httpapi/auth_refresh.go` — rotation tx + reuse detection (revoked row hit → revoke all)
- [x] `internal/httpapi/auth_logout.go` — `/logout` + `/logout-all` + inline `requireAccessToken`
- [x] `internal/httpapi/middleware_authn.go` — `RequireAccessToken` chi middleware + `ClaimsFromContext`
- [x] `internal/httpapi/middleware_ratelimit.go` — per-IP token bucket (rate.Limiter), 5 burst/sustained 1/12s, 429+Retry-After
- [x] Router wire: `/auth/{login,refresh,totp/verify}` brute-RL altında
- [x] `golang.org/x/time v0.3.0` indirect → direct
- [x] ~40 yeni test case (toplam 126 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### ✅ PR-7: Change-password + recovery + RBAC iskeleti + session binding flag — `feat/server-auth-recovery` (REVIEW BEKLIYOR)

**Üç onaylanmış karar:** (1) change-password = priv re-wrap, public_key sabit (item_shares korunsun); (2) recovery counter login ile paylaşılan; (3) RBAC bu PR'da sadece RequireRole + Permission tipi (DB resolver PR-8'de).

- [x] `/auth/change-password` — Bearer access, current pwd verify + tek tx (users + user_keypairs priv re-wrap + revoke all 'admin'); audit `auth.password_changed`
- [x] `/auth/recover/init` — generic 401 (no username enumeration), Argon2id verify, tek tx (used_at + revoke all 'recovery'), tmp_token purpose=recovery; audit `auth.recover` (step=init) / `auth.recover_fail`
- [x] `/auth/recover/complete` — tmp_token gated, FULL keypair rotate (new pub_key, item_shares accessibility kaybedilir), DELETE+INSERT recovery_codes (10 yeni), defansif revoke all; audit `auth.recover` (step=complete) + `auth.password_changed` (via=recovery)
- [x] `RequireRole(allowed...)` middleware — admin bypass + claims.Roles intersection
- [x] `Permission` tipi + sabitler (None/Read/Write) + `Allows(want)` semantiği
- [x] Session binding flag — `auth.SessionRow` UA/IP fields + `bindingChanged()` + refresh handler audit `auth.session_binding_changed`
- [x] Audit constant `ActionAuthSessionBindingChanged`
- [x] Router wire: brute RL `/recover/init`'te
- [x] ~24 yeni unit test case (toplam 150 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### ✅ PR-8: Folder CRUD + folder_permissions + RBAC ancestor walk — `feat/server-folder-crud` (REVIEW BEKLIYOR)

**Faz 2 son halkası 2'ye bölündü** (3 erteleme cost-of-delay 0): WebSocket → Faz 3, item_relationships + field/type admin → Faz 5.

- [x] `internal/auth/folders.go` — `ResolveFolderPermission` (recursive CTE + 4 bool aggregate)
- [x] `FolderPermission` tip + `AllowsRead/Write` semantiği
- [x] `POST/GET/PUT/DELETE /api/v1/folders` — CRUD + name envelope encrypt + HMAC blind index
- [x] `POST /api/v1/folders/:id/permissions` — UPSERT grant (idempotent, self-grant engeli)
- [x] `DELETE /api/v1/folders/:id/permissions/:user_id` — soft revoke
- [x] Audit: 5 yeni constant + `ResourceFolder`
- [x] Router wire: `RequireAccessToken` middleware altında
- [x] cmd/api/main.go: `FolderHandlers` wire
- [x] ~8 yeni unit test case (toplam 158 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

### ✅ PR-9: Item CRUD + item_shares + ResolveItemPermission — `feat/server-item-crud` (REVIEW BEKLIYOR — Faz 2 SON HALKA)

- [x] `POST/GET/PUT/DELETE /api/v1/items` — CRUD (two-layer envelope: server_dek master-wrapped, name DEK-encrypted)
- [x] Client-generated UUID v7 (AAD-pending sorunu çözümü)
- [x] `item_fields` — client-encrypted blob'lar (field_definition_id FK + value_enc + value_nonce)
- [x] `POST/DELETE /api/v1/items/:id/shares` — UPSERT grant + soft revoke + owner-share koruması
- [x] `auth.ResolveItemPermission` — owner + direct share + folder ancestor walk (max)
- [x] Item search (HMAC blind index, name_search deterministik eşleşme)
- [x] 6 yeni audit constant + ResourceItem
- [x] `extractNonce` refactor (unused param removed)
- [x] ~16 yeni unit test (toplam 174 PASS)
- [x] Lokal validation: build / test / gofmt / golangci-lint clean

---

## 🎯 Faz 2 — Server MVP TAMAMLANDI (PR-9 merge sonrası)

PR-9 main'e merge edildiğinde Faz 2 biter. Server tarafı tam fonksiyonel:
- 10 auth endpoint (register/TOTP/login/refresh/logout/logout-all/change-pwd/recover-init/recover-complete + tmp_token gate)
- Folder CRUD + ACL (3 katmanlı RBAC: admin/owner/inherit)
- Item CRUD + sharing (E2E hibrit: metadata server-side envelope, secret client-side)
- 24 audit action + brute-force guards (rate limit + lockout) + session binding flag
- 174 unit test PASS, 17 migration, ~10K LOC

Faz 2 ertelemeleri (mimari cost-of-delay 0):
- WebSocket `/ws` → Faz 3 (web UI consumer ile birlikte)
- item_relationships → Faz 5 / parking lot
- field_definitions / item_types admin API → Faz 5

- [ ] Folder CRUD
- [ ] Item CRUD (metadata envelope + secret client-provided)
- [ ] Item share + folder_permissions effective resolution
- [ ] Item relationships API
- [ ] WebSocket hub (`/ws`)

## Tamamlanan: Faz 0 — Temel kurulum (VERIFY bekliyor)

- [x] Monorepo dizin yapısı
- [x] Root config dosyaları
- [x] Go modülü + workspace
- [x] Docker Compose dev stack (Postgres 16 + Adminer + Mailhog)
- [x] `golangci-lint` + pre-commit hook
- [x] GitHub Actions CI iskeleti
- [x] İlk 3 ADR (tech-stack, security-model, repo-layout)
- [x] Web iskeleti (Vite + React + TS)
- [x] Tauri client iskeleti
- [x] Smoke test kılavuzu: `docs/smoke-test.md`

### User aksiyonu (Faz 0)

- [!] `docs/smoke-test.md`'deki adımları lokal makinede çalıştır
- [!] (Opsiyonel) GitHub'a push et, CI yeşil olsun
- [!] (Opsiyonel) Branch protection kurallarını `main` için ayarla

## Tamamlanan: Faz 1 — Veri modeli + kripto tasarımı

- [x] ER diyagram — `docs/diagrams/er.mmd` (11 tablo)
- [x] ADR-0004: şifreleme detayları (AES-GCM, Argon2id, X25519, HMAC search)
- [x] ADR-0005: migration tool = goose
- [x] Auth akış dokümantasyonu — `docs/auth-flow.md` (9 senaryo, Mermaid sequence)
- [x] 5 migration: `00001_init_extensions`, `00002_users`, `00003_roles`, `00004_sessions`, `00005_audit_log`
- [x] OpenAPI 3.1 spec — `shared/api/openapi.yaml` (health + 10 auth endpoint)
- [x] Code gen config: `sqlc.yaml`, `oapi-codegen.yaml`, Makefile `gen` hedefleri
- [x] İlk sqlc query'leri: users, sessions, roles, audit_log

### User aksiyonu (Faz 1)

- [!] `make tools-install` — sqlc, oapi-codegen, goose, golangci-lint kur
- [!] `make up` → Postgres dev stack
- [!] `make migrate-up` → schema'yı uygula
- [!] Adminer'da (http://localhost:8081) şema'yı gözden geçir
- [!] `make gen` → generated code üret (commit'le)
- [!] `make lint-openapi` (opsiyonel) — OpenAPI spec Redocly ile validate

---

## Sıradaki: Faz 2 — Server MVP (~1 hafta)

### Altyapı
- [ ] HTTP server (chi router) + middleware: logging (slog), recovery, request-id, CORS
- [ ] Config loader (`internal/config`) — env → struct + validation
- [ ] DB katmanı (pgx v5 pool + sqlc generated queries), connection health check
- [ ] Crypto package (`internal/crypto`): envelope encrypt/decrypt, AAD helpers, known-answer tests

### Ek migration'lar (Faz 2 kapsamı — 12 yeni dosya)
- [ ] `00006_user_keypairs.sql`
- [ ] `00007_totp_secrets.sql`
- [ ] `00008_recovery_codes.sql`
- [ ] `00009_master_keys.sql`
- [ ] `00010_item_types.sql` + seed (8 tip: server, url, database, ssh_key, certificate, cloud_credential, note, generic)
- [ ] `00011_field_definitions.sql` + seed (~20 field tanımı, environment + criticality enum dahil)
- [ ] `00012_folders.sql`
- [ ] `00013_folder_permissions.sql`
- [ ] `00014_items.sql` (**`external_source jsonb` kolonu dahil**, Vault için hazır)
- [ ] `00015_item_fields.sql` (**`field_definition_id` FK**, `value_enc` nullable, `is_secret` yok)
- [ ] `00016_item_shares.sql`
- [ ] `00017_item_relationships.sql` (5 relationship_type CHECK)

### Auth
- [ ] Argon2id password hash/verify
- [ ] TOTP (RFC 6238) enroll + verify
- [ ] JWT access (15dk) + opaque refresh (7g, rotating) + auth middleware
- [ ] Session binding (UA/IP flag) + token reuse detection
- [ ] Rate limit middleware (login, TOTP verify, refresh, recover)
- [ ] Account lockout (10 fail → 30dk lock)
- [ ] **RBAC middleware — 3 katmanlı effective permission:**
  1. admin role check (bypass all)
  2. item_shares check
  3. folder_permissions ancestor walk (inherit_to_children)
- [ ] Item relationships API (create/list/filter by type, jump server traversal)
- [ ] field_definitions admin API (list/create, sadece admin mutation)
- [ ] item_types admin API (list/create, sadece admin mutation)

### Endpoint implementasyonu (oapi-codegen handler interface)
- [ ] `/healthz`, `/readyz`
- [ ] `/auth/register`, `/auth/totp/init`, `/auth/totp/verify`
- [ ] `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`
- [ ] `/auth/change-password`, `/auth/recover/init`, `/auth/recover/complete`
- [ ] (Faz 2 scope): Folder CRUD, Item CRUD (metadata envelope + secret client-provided), Item share
- [ ] WebSocket hub (`/ws`): pub/sub change events

### Audit + test
- [ ] Audit log yazıcı (middleware + explicit call helper)
- [ ] Unit test (crypto, auth logic, RBAC)
- [ ] Integration test (testcontainers-go + gerçek Postgres + migration up/down/up)
- [ ] OpenAPI docs serve (`/docs` — embedded spec)
- [ ] CI: `server-integration` job

## Faz 3 — Admin Web UI (~4-5 gün)

- [ ] Auth akışı (login + MFA form)
- [ ] Session yönetimi (refresh token rotation)
- [ ] User/role yönetim sayfası (CRUD)
- [ ] Envanter ağaç + tablo view (KeePassXC tarzı layout)
- [ ] Folder oluştur/düzenle/sil modali
- [ ] Item edit formu (field tipleri: text, password, url+cred, hardware spec)
- [ ] WebSocket entegrasyonu (live update)
- [ ] Audit log görüntüleyici
- [ ] Responsive layout + dark mode

## Faz 4 — Client MVP Tauri (~1-2 hafta)

- [ ] Tauri project config Windows + macOS target
- [ ] Server connection config ekranı (URL + TLS cert trust)
- [ ] Auth akışı (login + MFA + master key derive Argon2id)
- [ ] Master key in-memory vault (uygulama kapanınca silinir)
- [ ] Envanter UI (ağaç + detay panel, KeePassXC görseli)
- [ ] WebSocket live sync
- [ ] Şifrelenmiş offline cache (SQLite + SQLCipher, local DEK master key'den derive)
- [ ] Client-side E2E şifreleme (secret field'lar)
- [ ] Reconnect logic + offline mode indicator
- [ ] Copy-to-clipboard auto-clear (30sn)
- [ ] Auto-lock after idle (10dk default, 5/10/15/30 configurable)

## Faz 5 — Production hardening (~1 hafta)

### k8s / Deploy

**Mac M4 tarafında erken yapılan (ADR-0008):**
- [x] Server + Web Dockerfile (multi-stage, scratch + nginx)
- [x] GHCR pipeline (multi-arch amd64+arm64)
- [x] Raw k8s manifests (namespace, configmap, secret, postgres+PVC, api, web, adminer, mailhog)
- [x] ArgoCD Application (auto-sync, prune, self-heal)

**Hâlâ yapılacak:**
- [!] **🚨 secret.yaml plaintext fix** (yukarıda kritik bölüm)
- [ ] Sealed Secrets veya External Secrets Operator adoption
- [ ] Image versioning — `:latest` yerine git SHA / semver tag
- [ ] Resource limits + HPA + PodDisruptionBudget
- [ ] Pod Security Standards (runAsNonRoot, readOnlyRootFilesystem, drop caps)
- [ ] NetworkPolicy (pod-to-pod traffic kısıtlama)
- [ ] TLS config + Ingress (cert-manager + Let's Encrypt) — NodePort retire
- [ ] Helm chart migration (opsiyonel — raw YAML yeterli olursa atlanır)
- [ ] DB migration init container (api Deployment) — PR-2 ile koordineli
- [ ] Managed DB değerlendirmesi (Cloud SQL / RDS / on-prem HA cluster)
- [ ] Distroless image (server scratch yerine `gcr.io/distroless/static-debian12`)

### Observability
- [ ] Prometheus metrics (custom + runtime)
- [ ] Grafana dashboard template
- [ ] Structured logging (slog) + log aggregation uyumu

### Ops
- [ ] Backup/restore prosedürü + cron
- [ ] KMS entegrasyonu (master_keys rotation batch job)

### External Secret Backends (ADR-0007)
- [ ] `server/internal/vault` — HTTP client + k8s AppRole auth
- [ ] Item detail endpoint genişletme: `external_source` doluysa Vault passthrough
- [ ] Audit log integration — her Vault fetch `item.external_fetch` olarak log'lanır
- [ ] Web + client UI: "Vault-backed item oluştur" formu + key_mapping editor
- [ ] Bonus: Dynamic secrets flow (`POST /items/:id/dynamic-cred` → Vault'tan 15dk'lık cred)

### Packaging
- [ ] Win MSI packaging + code signing
- [ ] Mac .dmg packaging + notarization
- [ ] Tauri auto-updater (built-in vs self-hosted — Faz 4'te karar verilir)

### Release
- [ ] Production readiness checklist
- [ ] v1.0.0 release

---

## Parking Lot (ileride değerlendirilecek)

### Auth & Kimlik
- OIDC SSO (Azure AD / Okta / Keycloak) — Vault ile ortak kimlik
- Hardware key desteği (WebAuthn / FIDO2)

### External Secrets
- Vault auto-discovery polling (watched paths — pattern farkı nedeniyle MVP'den çıkarıldı)
- AWS Secrets Manager support (aynı `external_source` mekanizması)
- Azure Key Vault support
- GCP Secret Manager support

### Yetkilendirme
- Groups / teams (direkt user-permission → group-permission; büyük takımlar için)
- Deny override rules for `folder_permissions` (şu an sadece grant)

### Platform
- Mobile client (iOS / Android) — Tauri 2 mobile
- Browser extension (kayıt otomatik doldurma)
- CLI client (grep + find envanterinde)
- Terraform provider

### Feature
- Paylaşım linkleri (geçici, token-based, TTL'li erişim)
- Item versioning / change history görüntüleme
- Bulk import/export (CSV, KeePassXC .kdbx import)
- Telemetri (opsiyonel, self-hosted, anon kullanım istatistikleri)
- Searchable encryption — full-text arama için bigram/trigram blind index

---

## Kararlaştırılacak Açık Noktalar

- [ ] Frontend state management: Zustand mi Redux Toolkit mi? → Faz 3'te karar
- [x] ~~OpenAPI generator'dan Go client de üretilsin mi?~~ → **Karar: sadece server tarafı oapi-codegen**. Integration test için doğrudan `net/http` veya `resty` kullanılır (Faz 2'de kesinleşir).
- [ ] Client auto-update mekanizması: Tauri built-in updater mı self-hosted mı? → Faz 4'te karar
- [ ] Postgres HA / replication stratejisi (tek master + read replica?) → Faz 5'te karar
- [ ] sqlc override'larda `inet` için `netip.Addr` mı `net.IP` mi? → Faz 2 implementation'da netleşir

## Tamamlanan Kararlar

### Cross-machine deploy iterasyonu (2026-04-25, Mac M4)
- **Container images:** Multi-stage (server: scratch, web: nginx)
- **Registry:** GHCR (multi-arch amd64+arm64)
- **K8s deploy:** Raw YAML manifests (Helm yerine, başlangıç için)
- **GitOps:** ArgoCD Application (auto-sync, prune, self-heal)
- **CI:** docker build/push job, push to main only
- ADR-0008'de detaylı

### İlk iterasyon
- UUID v7 client-üretimli (AAD pending problemi için)
- MFA zorunlu (login'de TOTP, unlock'ta sadece master password)
- Recovery code → yeni keypair (solo item kaybı kabul, prominent UI uyarı)
- Auto-lock default 10dk, configurable 5/10/15/30
- Searchable encryption HMAC-SHA256 hash (frequency leak kabul)
- Session binding = flag not block; token reuse → tüm session'lar revoke
- Migration tool: goose
- Atlas yerine SQL-first — review disiplini için

### Genişleme iterasyonu (UX + RBAC + Vault)
- **item_types:** Ayrı tablo (enum değil) — admin yeni tip ekleyebilir. 8 seed tip.
- **field_definitions:** Merkezi field sözlüğü, hostname/host_name drift engellendi. `is_secret` tanımın parçası. Enum desteği (`allowed_values jsonb`).
- **item_relationships:** 5 tip (hosted_on, accessed_via, part_of, related_to, depends_on). Jump server zinciri `accessed_via` ile.
- **3-katmanlı RBAC:** Global rol (admin/write/read) + folder_permissions (inherit_to_children) + item_shares.
- **Vault entegrasyonu:** Proxy modeli — DB'ye yazmaz, passthrough. `items.external_source jsonb` schema hazırlığı Faz 2, implementation Faz 5.
- **Vault auth:** k8s Service Account → Vault AppRole (MVP). OIDC SSO parking lot.
- **Vault linking:** Manuel-only. Auto-discovery parking lot.
- **Environment/criticality:** Enum field_definition seed'i (prod/stage/test/dev/lab ve critical/high/medium/low).
- **Organizational convention:** Proje × ortam folder yapısı tavsiye edilir, zorunlu değil.
