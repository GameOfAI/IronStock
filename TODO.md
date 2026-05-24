# Yapılacaklar

Son güncelleme: 2026-05-24 — PR-PROD4 (UX Polish) tamamlandı ✅; PR-PROD1/2/3 tamamlandı ✅
Tüm Faz 9 (PR-ANSIBLE/ALERT/SCIM/SIEM/SCAN) + Faz 10 (PR-CLI) + Faz 11 PR-PROD1/2/3/4 merged.
Sonraki: PR-PROD5 (Perf+SLO), PR-PROD6 (Docs), PR-PROD7 (DR+Backup).

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

## ✅ Tamamlandı: Faz 3 — Admin Web UI (2026-04-26 → 2026-04-27)

**Sonuç:** 9 PR (Win 6 + Mac 3), 1 gün — tümü merged. WS realtime, E2E kripto, admin+inventory UI tamamlandı.

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

#### ✅ PR-W3: Admin screens — `feat/web-admin` (**Mac**) — review/merge bekliyor

- [x] User list page (`/admin/users`): table + pagination + role badges (URL state)
- [x] Role assign/revoke (DropdownMenu içinde 3 checkbox + optimistic + toast)
- [x] Disable/enable toggle (AlertDialog confirm + self-protection guards)
- [x] Audit log viewer (`/admin/audit-log`): 5 filter + URL state + pagination + Collapsible inline JSON details
- [x] Empty state, loading skeleton, error toast (her sayfada)
- [x] Unit tests — 29 test, 7 dosya (hook calls + table render + audit row + pagination)
- [x] Self-protection: kendi admin rolü ve disable disabled + tooltip
- [x] Username mapping: useUsers cache → userMap, "Sistem"/"silinmiş kullanıcı" fallback (ADR-0009 §5)
- [x] shadcn primitives: badge, dropdown-menu, checkbox, collapsible, popover, tooltip, alert-dialog

#### ✅ PR-W4: Inventory read — `feat/web-inventory-read` (**Mac**) — review/merge bekliyor

- [x] Folder tree component (sol sidebar, recursive expand/collapse, lazy load per level)
- [x] Item list (orta panel): tablo + folder-scoped + debounced search (HMAC blind index, exact match)
- [x] Item detail panel (sağ): metadata + field listesi (catalog'dan label/key/type)
- [x] Empty/loading states (her panelde)
- [x] Permission badges per item (read/write — compact W/R + full label)
- [x] Unit tests — 34 test, 7 dosya
- [x] URL state pattern: `?folder=&item=&q=` (PR-W3 ile tutarlı)
- [⏸] **Field decrypt** — PR-W5'te. Server itemResponse'a `owner_dek_wrapped + wrap_nonce` eklenmesi gerekiyor; UI'da amber info kutusu ile kullanıcıya açıklandı.

#### ✅ PR-W5: Inventory write — `feat/web-inventory-write` (**Mac**) — CI bekliyor

- [x] Folder create modal (parent picker ile — `FolderFormModal` create mode)
- [x] Folder rename modal (`FolderFormModal` edit mode, `editFolder` prop)
- [x] Folder delete dialog (`FolderDeleteDialog` — cascade sil uyarısı)
- [x] Item create form (item type seçimi + dynamic field rendering by field_definition)
- [x] Field tipleri: text / password (toggle Eye/EyeOff) / url / email / port / multiline (textarea) / enum (Select)
- [x] **Client-side encryption:** DEK gen + AES-GCM field encrypt + MVP sealed-box wrap (SHA256(privateKey) → wrap key; X25519 sealDEK hazır, server DEK expose edilince geçiş)
- [x] Item edit (ad-only — alan decrypt için server `owner_dek_wrapped` expose gerekiyor; amber banner)
- [x] Item delete dialog (`ItemDeleteDialog` — confirm + onDeleted callback)
- [x] Sharing modal (`ItemShareModal` — UI hazır + amber banner; server expose bekleniyor)
- [x] Unit tests — 21 test, 4 dosya (crypto + folder modal + item modal + delete dialog)
- [x] Toolbar: folder (Yeni/Rename/Sil) + item (Yeni/Düzenle/Paylaş/Sil) butonları inventory sayfasına eklendi
- [⏸] **Alan decrypt + gerçek X25519 sharing** — Win'de server `item_handlers.go` → `itemResponse`'a `owner_dek_wrapped + wrap_nonce` eklenince aktif

#### ✅ PR-W6: Realtime + polish — `feat/web-realtime-polish` — CI bekliyor

- [x] WebSocket client (`api/ws.ts` — connect + exponential backoff reconnect + event dispatch)
- [x] Event handlers: folder/item mutasyonlarında `queryClient.invalidateQueries` (cache invalidation)
- [x] Reconnect logic (1s → 2 → 4 → … → 30s cap, attempt counter sıfırlanır open'da)
- [x] Dark mode toggle (ThemeToggle zaten vardı, AppShell'e entegre + `sidebarCollapsed` persist)
- [x] Responsive: hamburger mobile + icon-only collapsed desktop sidebar (md breakpoint)
- [x] A11y: `role="navigation"`, `aria-label` tüm icon button + nav link'lere, `role="main"`
- [x] WsProvider (React Context ile status expose, `useWsStatus()` hook)
- [x] WS status indicator (TopBar'da: connected→gizli, reconnecting→spinner, offline→WifiOff)
- [x] Server: `?access_token=` query param fallback (browser WS header seti yapamıyor)
- [x] **10 yeni test** (WsClient status transitions + WsProvider render/status)
- [⏸] i18n (react-i18next) → Faz 4+ (UI zaten Türkçe, priority düşük)
- [x] **Faz 3 DONE** — PR-W6 merged ✅ 2026-04-27

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

## Aktif: Faz 4 — Client MVP Tauri

**İş bölümü:** Mac bağımlılık gerektirmeyen PR'lar (S1, C2, C3, C4, C5), Win platform-specific PR'lar (C1 keyring/Rust, C6 Win binary).

### Ortak (Shared) PR'lar

#### ✅ PR-S1: @envanter/shared workspace — `feat/shared-workspace` — merged

- [x] Root `package.json` (npm workspaces: shared/pkg, web, client)
- [x] `shared/pkg/` → `@envanter/shared` paketi (crypto + api/types + api/errors)
- [x] `web/src/{lib/crypto,api/types,api/errors}.ts` → re-export stub'ları
- [x] `client/package.json` + `web/package.json` → `@envanter/shared` bağımlılığı
- [x] `vitest.config.ts` ayrıldı (tailwindcss plugin → lightningcss Linux sorunu çözüldü)
- [x] Root `package-lock.json` `.gitignore`'a eklendi
- [x] CI: Install adımı root'tan çalışıyor

### Client PR'ları (Mac — bağımlılık yok)

#### ✅ PR-C2: Client foundation — `feat/client-foundation` — CI bekliyor

- [x] `client/package.json` → Tailwind 4, shadcn/ui, TanStack Query, Zustand, Radix UI, react-router-dom
- [x] `client/vite.config.ts` + `client/vitest.config.ts` (ayrı — lightningcss dersi öğrenildi)
- [x] `client/tsconfig.json` + path alias `@/`
- [x] `client/src/` AppShell (Tauri window chrome yok, kendi app shell — admin nav yok, Lock butonu var)
- [x] React Router v6: `ConnectionGate` (sunucu URL girilmemişse config ekranı) + `AuthGate`
- [x] Connection config ekranı (URL + TLS bypass) + `store/connection.ts` (persist + api/client sync)
- [x] `api/client.ts` — configurable base URL (setBaseUrl/getBaseUrl)
- [x] `store/{auth,ui,connection}.ts`, `api/{errors,types,token-storage,query,client}.ts`
- [x] shadcn/ui primitives: button, input, label, skeleton, card, toast, toaster
- [x] 21 test case (cn, token-storage, auth store, connection store, api/client)
- [x] CI: `client` job eklendi (tsc + lint + test + vite build, Tauri binary derlenmez)

#### ✅ PR-C3: Client auth — `feat/client-auth` — merged 2026-04-27

- [x] Login formu (username + master_password + TOTP)
- [x] KEK derive (Argon2id via `@envanter/shared/crypto`) + private_key decrypt
- [x] Auth state: Zustand (memory-only, Faz 4 MVP — Rust keyring PR-C1'e kadar)
- [x] Logout + auto-lock hook (inactivity timer — JS side; PR-C1'de Rust'a taşınır)
- [x] TOTP setup wizard (yeni kullanıcılar için)
- [x] `@/api/client.ts` Bearer + refresh interceptor (web'den adapt)

#### ✅ PR-C4: Client inventory read — `feat/client-inventory-read` — merged 2026-04-27

- [x] Folder tree (sol panel, lazy load)
- [x] Item listesi (orta panel, debounced search)
- [x] Item detail panel (sağ — alanlar amber "şifreli" placeholder)
- [x] WsClient + WsProvider (`@envanter/shared` import)
- [x] TanStack Query: folder/item hook'ları

#### ✅ PR-C5: Client E2E decrypt — `feat/client-crypto` — merged 2026-04-27

- [x] Field decrypt UI (DEK açma + alan gösterme)
- [x] Copy-to-clipboard auto-clear (30sn)
- [x] Password field toggle (Eye/EyeOff)
- [x] Item create/edit/delete form + E2E encrypt

### Client PR'ları (Win — platform-specific)

#### [~] PR-C1: Rust keyring + inactivity lock + tray — `feat/client-rust-foundation`

- [x] `keyring = "2"` (Windows Credential Manager / macOS Keychain) → KEK persist
- [x] Inactivity timer Rust side (30s poll, 10dk default, `set_inactivity_timeout` command)
- [x] System tray icon (Göster / Kilitle / Çıkış menüsü)
- [x] Auto-lock → `inactivity_lock` event → frontend clear()
- [x] `src/lib/tauri.ts` — `isTauri()` guard + typed wrappers
- [x] `use-inactivity-lock.ts` — Tauri event path + browser fallback
- [x] `login.tsx` — kekStore after setSession
- [x] `app-shell.tsx` — handleLock/handleLogout → kekDelete before clear

#### [~] PR-C6: Windows binary + packaging — `feat/client-win-packaging` — PR #7 CI bekliyor

- [x] App ikonları: `icons/32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`
- [x] `tauri.conf.json` — productName=IronStock, icon paths, NSIS currentUser config
- [x] `client/package.json` — `tauri:build:win` script
- [x] `.github/workflows/ci.yml` — `client-tauri-win` job (windows-latest + msvc + rust-cache + artifact upload)
- [ ] Code signing — Faz 5'e ertelendi (self-signed sertifika kurulumu)

### Server PR'ları (Win — web ile uyum)

#### ✅ PR-13: Server item DEK expose — `feat/server-item-dek` — merged 2026-04-27

- [x] `itemResponse` → `owner_dek_wrapped + owner_wrap_nonce` alanları eklendi
- [x] Client decrypt + real X25519 sharing aktif oldu (amber banner kalktı)

### Ertelenen (Win PR'ı bekliyor)

- [⏸] Alan decrypt tam çalışması → PR-13 (server DEK expose) merge sonrası
- [⏸] Gerçek X25519 sharing → PR-13 sonrası (web share modal amber banner)
- [⏸] Rust keyring entegrasyonu → PR-C1 (Win) sonrası

## ✅ Tamamlandı: Faz 5 — Production hardening (2026-04-28)

**PR Planı:**

| # | Branch | Kapsam | Öncelik | Durum |
|---|--------|--------|---------| ------|
| PR-K1 | `feat/k8s-hardening` | GHCR ref fix + Kustomize image versioning + resource limits + securityContext + PSS label + PDB | Kritik | ✅ merged |
| PR-K2 | `feat/k8s-sealed-secrets` | Sealed Secrets CRD + secret.yaml → SealedSecret | Yüksek | ✅ merged |
| PR-K3 | `feat/k8s-network` | Ingress + cert-manager + NetworkPolicy | Yüksek | ✅ merged |
| PR-K4 | `feat/server-observability` | Go `/metrics` endpoint (Prometheus) + ServiceMonitor + Grafana dashboard JSON | Orta | ✅ merged |
| PR-K5 | `feat/k8s-minio` | MinIO k8s StatefulSet + docker-compose servisi + secret + StorageBackend interface | Orta | ✅ merged |
| PR-A1 | `feat/item-description` | `items.description` migration + server endpoint + web/client UI (textarea) | Orta | ✅ merged |
| PR-A2 | `feat/item-attachments` | `item_attachments` migration + presigned URL API + upload/download UI | Orta | ✅ merged |
| PR-K6 / PR-VAULT | `main` | `server/internal/vault` package + item endpoint passthrough + audit | Düşük | ✅ 2026-05-22 |
| PR-P1 | `feat/client-packaging-2` | Tauri auto-updater config + macOS Universal DMG CI | Orta | ✅ merged |
| PR-V1 | `feat/release-v1` | Production readiness checklist + version bump + v1.0.0 tag | Son | ✅ merged |

### k8s / Deploy

**Mac M4 tarafında erken yapılan (ADR-0008):**
- [x] Server + Web Dockerfile (multi-stage, scratch + nginx)
- [x] GHCR pipeline (multi-arch amd64+arm64)
- [x] Raw k8s manifests (namespace, configmap, secret, postgres+PVC, api, web, adminer, mailhog)
- [x] ArgoCD Application (auto-sync, prune, self-heal)

#### ✅ PR-K1: k8s hardening batch-1 — `feat/k8s-hardening` — merged 2026-04-28

- [x] GHCR ref düzeltildi (`bhaslaman` → `gameofai`) — api.yaml, web.yaml + init container + ArgoCD repoURL
- [x] `deploy/k8s/kustomization.yaml` — Kustomize `images:` ile image tag yönetimi
- [x] `namespace.yaml` — Pod Security Standards `warn: restricted` label
- [x] `api.yaml` — resource limits/requests, securityContext (runAsNonRoot+drop ALL), readyzProbe, PDB
- [x] `web.yaml` — resource limits, securityContext, liveness+readiness probe eklendi
- [x] `postgres.yaml` — resource limits, securityContext (fsGroup+runAsUser 999)
- [x] `ci.yml` — docker job `contents: write` + "Update k8s image tags" step (kustomize+git commit [skip ci])

#### ✅ PR-K2: Sealed Secrets — `feat/k8s-sealed-secrets` — merged 2026-04-28

- [x] Sealed Secrets controller kurulum dokümanı (`docs/ops/sealed-secrets.md`)
- [x] `secret.yaml` → `secret.sealed.yaml` (kubeseal ile şifrelenmiş SealedSecret)
- [x] `secret.yaml.example` güncelleme — beklenen key'ler (MINIO dahil)
- [x] Makefile: `sealed-secrets-install`, `sealed-secrets-fetch-cert`, `seal-secret` target'ları
- [x] `deploy/k8s/pub-cert.pem` kaydedildi

#### ✅ PR-K3: Ingress + TLS + NetworkPolicy — `feat/k8s-network` — merged 2026-04-28

- [x] `deploy/k8s/ingress.yaml` — cert-manager annotation + TLS secret ref
- [x] `deploy/k8s/network-policy.yaml` — postgres: api-only, api: ingress+internal, web: ingress-only
- [x] kustomization.yaml — ingress.yaml + network-policy.yaml eklendi

#### ✅ PR-K4: Observability — `feat/server-observability` — merged 2026-04-28

- [x] `server/internal/metrics/` — Prometheus registry + HTTP handler + custom counters
- [x] `GET /metrics` endpoint (no auth — scrape-only)
- [x] `deploy/k8s/servicemonitor.yaml` — Prometheus Operator ServiceMonitor CRD
- [x] `deploy/grafana/dashboard.json` — HTTP rate, latency p50/p95, DB conns, auth failures panel

#### ✅ PR-K5: MinIO — `feat/k8s-minio` — merged 2026-04-28

- [x] `deploy/k8s/minio.yaml` — StatefulSet + Service + PVC (10Gi)
- [x] `secret.yaml.example` — `MINIO_ROOT_USER` + `MINIO_ROOT_PASSWORD` key'leri
- [x] `server/internal/storage/` — `StorageBackend` interface + `MinioBackend` (minio-go/v7)
- [x] kustomization.yaml — minio.yaml eklendi

#### ✅ PR-A1: Item description — `feat/item-description` — merged 2026-04-28 (PR#15)

- [x] `server/migrations/00018_item_description.sql` — `items.description TEXT` sütunu
- [x] Server: `itemResponse` + `createItemRequest` + `updateItemRequest`'a `description` alanı
- [x] Web: item detail panelinde gösterim + edit formuna textarea ekleme
- [x] Client: item detail + edit form güncelleme

#### ✅ PR-A2: Item attachments — `feat/item-attachments` — merged 2026-04-28 (PR#16)

- [x] `server/migrations/00019_item_attachments.sql` — `item_attachments` tablosu
- [x] `POST /api/v1/items/:id/attachments` — presigned PUT URL + DB record
- [x] `POST /api/v1/items/:id/attachments/:att_id/confirm` — upload onayı
- [x] `GET /api/v1/items/:id/attachments` — liste (meta)
- [x] `GET /api/v1/items/:id/attachments/:att_id/url` — presigned GET URL
- [x] `DELETE /api/v1/items/:id/attachments/:att_id` — DB + MinIO silme
- [x] Web + Client: ItemAttachmentPanel (upload, download, delete)
- [x] Config: ENVANTER_MINIO_* env vars + k8s configmap güncellemesi

#### ✅ PR-P1: Client packaging 2 — `feat/client-packaging-2` — merged 2026-04-28 (PR#17)

- [x] `tauri.conf.json` — auto-updater endpoint + signature config
- [x] `client/src-tauri/capabilities/default.json` — updater capabilities
- [x] `ci.yml` — `client-tauri-macos` job (macos-latest, universal binary: aarch64+x86_64)
- [x] `ci.yml` — `github-release` job (tag push → GitHub Release + Win NSIS + Mac DMG asset)

#### ✅ PR-V1: Release v1.0.0 — `feat/release-v1` — merged 2026-04-28 (PR#18)

- [x] `client/package.json`, `client/src-tauri/Cargo.toml`, `client/src-tauri/tauri.conf.json` → `1.0.0`
- [x] `shared/pkg/package.json`, `web/package.json` → `1.0.0`

**Post-v1.0.0 / Faz 6+ genel:**
- [ ] Distroless image (server `alpine` → `gcr.io/distroless/static-debian12`)
- [ ] Managed DB değerlendirmesi (Cloud SQL / RDS / on-prem HA cluster)
- [ ] nginx `readOnlyRootFilesystem: true` — emptyDir volume + custom config
- [ ] Win MSI code signing

---

## 🚀 Post-v1.0.0 Kapsamlı Geliştirme Planı (2026-05-16)

Ürün araştırması + güvenlik analizi sonucu eklenen 19 PR. Kaynak: Kapsamlı Geliştirme Planı (glistening-singing-moth.md).

### ✅ Tier 1 — Kritik / Güvenlik

- [x] **PR-RT-1** — WS ticket endpoint: URL'de access_token yerine kısa-ömürlü bilet (`POST /api/v1/ws/ticket`, 30s TTL, tek kullanım). `ws.TicketStore` in-memory. Web `ws.ts` güncellendi.
- [x] **PR-F1** — Default admin + `must_change_password`: İlk başlatmada `admin` kullanıcısı seed'lenir, random şifre stdout'a yazılır, şifre değiştirene kadar tüm route'lar bloke. `MustChangePasswordGate`, `/change-password` sayfası.
- [x] **PR-N6** — Read event audit logging: `item.viewed`, `item.listed`, `folder.listed` audit action'ları eklendi. `WriteAsync` hot-path için goroutine + context.Background() ile latency'siz.

### ✅ Tier 2 — Önemli / Core Features

- [x] **PR-F2a** — TOTP yönetimi: `GET /auth/totp/status`, `DELETE /auth/totp` (devre dışı), `POST /auth/totp/backup-codes/regenerate`, `POST /admin/users/{id}/totp/reset`. Web `profile.tsx` TOTPManagementCard.
- [x] **PR-F4** — Smart Item Type Fields: `enum` → `Select`, `multiline` → `Textarea`, `number` → number input. Field group desteği (server + web form render).
- [x] **PR-F6a** — Groups CRUD: `groups` + `group_members` tablosu. Admin API: list/create/delete grup, add/remove member. Audit constants.
- [x] **PR-F6b** — Folder Group Permissions: `folder_group_permissions` tablosu. `ResolveFolderPermission` CTE'ye group_members JOIN eklendi. Admin API: grant/revoke folder-group izin.
- [x] **PR-F6c** — Groups Admin UI: `/admin/groups` sayfası, grup detay, üye yönetimi, folder izin modal.
- [x] **PR-N4** — Break-Glass Emergency Access: `users.is_break_glass` boolean. Login'de detect → tüm adminlere WS alert + notify. Admin toggle endpoint. Web `BreakGlassBanner` component.

### ✅ Tier 3 — Ekosistem Genişletme

- [x] **PR-F2b** — Trusted Device: 30 günlük "Bu cihazı hatırla". `trusted_devices` tablosu, SHA-256 cookie token, rolling TTL. Login flow entegrasyonu. Web: login checkbox + profile TrustedDevicesCard.
- [x] **PR-F5a** — Graph Handler: `GET /api/v1/graph` (RBAC-filtered nodes+edges), `POST/DELETE /items/{id}/relationships`. item_rel_type_chk genişletildi (uses_tool, builds_to, scans_with, deploys_to).
- [x] **PR-F5b** — Graph UI: `/graph` sayfası, node kartları (type badge + edges), ilişki ekleme/silme, arama. Nav sidebar'a GitBranch linki.
- [x] **PR-F5c** — Lifecycle Stages Backend: `lifecycle_stages` + `item_lifecycle_stages` tablosu (migration 00032). `GET /lifecycle-stages`, `GET/POST /items/{id}/lifecycle-stages` endpoint'leri. `LifecycleHandlers` struct.
- [x] **PR-F5d** — Pipeline Diagrams CRUD Backend: `pipeline_diagrams` + `pipeline_diagram_nodes` tablosu (migration 00033). 9 endpoint (diagram CRUD + node management + layout save + filtered graph). `PipelineHandlers` struct. TypeScript tipleri `shared/pkg/src/api/types.ts`'e eklendi. React Query hook'ları (`web/src/api/pipeline.ts` + `web/src/api/lifecycle.ts`).
- [x] **PR-F5e** — ReactFlow Integration + Pipeline Canvas: `@xyflow/react@^12.3.6` + `@dagrejs/dagre@^1.0.4`. Custom PipelineNode + PipelineEdge. Dagre LR auto-layout. DiagramSidebar item picker. `/pipeline` + `/pipeline/:id` sayfaları. ReactFlowProvider + CanvasInner pattern. Debounced layout save.
- [x] **PR-F5f** — Lifecycle Lanes View: `/pipeline/lifecycle` sayfası. 8 yatay swimlane. HTML5 native drag-and-drop. LifecycleStageBridge pattern (custom DOM event → hook). `GET /api/v1/graph` artık `lifecycle_stages` map döner. Atanmamış items alt bölüm.
- [x] **PR-F5g** — Pipeline Export + Polish: `html-to-image@^1.11.13`. PNG/SVG export (html-to-image + getNodesBounds + getViewportForBounds). Pipeline list sayfasına Lifecycle Lanes quick-link.
- [x] **PR-N7** — Tags + Favoriler: `tags`, `item_tags`, `user_favorites` tablosu. 9 endpoint. Web: inventory left panel favoriler, item detail tag chip'leri, ItemTagsPanel, FavoritesPage.
- [x] **PR-N8** — Notification Sistemi: `notifications` tablosu + partial index (unread). `notify.Writer` (sync + async). WS `notification.created` event. Web: TopBar bell badge + popover list + mark-all-read.
- [x] **PR-N1** — Credential Expiry/Rotation: `items.expires_at`, `rotation_interval_days`, `last_rotated_at`. Nightly scanner goroutine (1h tick, 7-gün penceresi, idempotent). Item detail expiry/rotation section. `POST /items/{id}/rotate`.
- [x] **PR-N2** — Secret Versioning: `item_field_versions` tablosu (max 10, FIFO). Trigger-benzeri hook field update'te. `GET /items/{id}/fields/{field_def_id}/versions` endpoint. Web: field history modal + restore.
- [x] **PR-N5** — One-Time Paylaşım Linki: `item_share_links` tablosu (token_hash SHA-256, dek_wrapped, view_limit 1-10, TTL). Public `GET /api/v1/share/{token}` (no auth, atomic view_count++, 410 Gone). E2E: link_key URL fragment'ta, asla sunucuya gitmez. Web: ShareLinkDialog + public SharePage.

### ✅ Son Tamamlananlar (2026-05-17~24)

- [x] **PR-UX1~5** — Kapsamlı UI/UX İyileştirmeleri ✅ 2026-05-17
- [x] **Item tam alan düzenleme** — edit modda DEK çözümleme + alan decrypt + re-encrypt on save ✅ 2026-05-17
- [x] **WS proxy + origin fix** — Vite proxy WS rule + `coder/websocket` OriginPatterns ✅ 2026-05-17
- [x] **Renkli telemetri dot** — yeşil/amber/kırmızı WS status indicator + hata detayı popover ✅ 2026-05-17
- [x] **CI test fix'leri** — `ws-provider.test` getDetail mock + `item-form-modal.test` waitFor pattern ✅ 2026-05-18
- [x] **PR-UX7** — Item Detail 5-tab layout ✅ 2026-05-19
- [x] **PR-UX4+UX6** — Inventory tip filtre chip'leri + ItemList ikon-satır tasarımı ✅ 2026-05-19
- [x] **PR-UX8** — Admin Dashboard (RadialGauge, expiry uyarıları, audit özeti) ✅ 2026-05-19
- [x] **PR-UX9** — Item form şablon galerisi: 11 quickstart şablon ✅ 2026-05-19
- [x] **PR-SEC4: WebAuthn/FIDO2** — migration 00049, `server/internal/webauthn/`, 4 endpoint (register/login begin/finish), admin toggle, web SecurityKeysCard + login dialog ✅ 2026-05-24
- [x] **PR-SEC5: GeoIP + IP Whitelist** — migration 00050, `server/internal/geoip/` (ip-api.com + Tor exit list), IP/CIDR/country check auth_login, admin_ip_restrictions.go, web dialog ✅ 2026-05-24
- [x] **PR-SCALE: Redis Pub/Sub** — `internal/cache/redis.go` (circuit-breaker), hub.go Redis fan-out, tickets.go Redis TTL, ratelimit Lua sliding window, deploy/k8s/redis.yaml, api.yaml replicas:3 ✅ 2026-05-24
- [x] **PR-LINK: Linked Entries** — migration 00051 (item_links mirror/reference), item_links.go CRUD, item update → mirror_link_ids, web linked-items-tab (E2E propagation) ✅ 2026-05-24
- [x] **PR-VAULT-DYN: Dinamik Vault Secret'ları** — vault/client.go IssueDynamicCred/RevokeLease, vault_dynamic.go POST /items/{id}/dynamic-cred, web countdown timer + auto-clear ✅ 2026-05-24
- [x] **PR-EXPORT: Şifreli Bulk Export** — admin_export_encrypted.go POST /admin/export/encrypted, ZIP (manifest+items+shares+keypairs), scope all/folder/user, web admin paneli ✅ 2026-05-24
- [x] **PR-SEARCH-FT: pg_trgm Trigram Arama** — migration 00052 (pg_trgm + GIN index), Search() ?fuzzy=true trigram sorgusu, web fuzzy ~ buton ✅ 2026-05-24
- [x] **PR-TPL: Kullanıcı Tanımlı Şablonlar** — migration 00053 (item_templates), TemplateHandlers CRUD mine/public/all, web template-gallery.tsx ✅ 2026-05-24
- [x] **PR-DUP: Duplicate Detection** — item_duplicates.go CheckDuplicates HMAC blind index, web item-form-modal amber uyarı banner ✅ 2026-05-24
- [x] **PR-HEALTH: Item Health Score** — migration 00054, `internal/health/score.go`, GetHealth + GetHealthReport endpoint, web Sağlık tab + admin UnhealthyItemsWidget ✅ 2026-05-24
- [x] **PR-CLI: ironstock Go CLI** — `cli/` monorepo, cobra komut ağacı, .goreleaser.yml multi-arch, docs/integrations/cli.md ✅ 2026-05-24
- [x] **PR-PROD1: CI Security Scanning** — security.yml (gosec+trivy+semgrep+gitleaks+kubesec), dependabot.yml ✅ 2026-05-24
- [x] **PR-PROD2: Test Coverage Uplift** — 41 yeni test, 4 paket (admin_k8s, k8s_proxy, admin_report, clientcert) ✅ 2026-05-24
- [x] **PR-PROD3: Playwright E2E Suite** — 10 senaryo 39 test, docker-compose.e2e.yml, e2e.yml workflow ✅ 2026-05-24

### ⏳ Kalan

- [x] **PR-F3** — Tauri Client Sync: KeyringBootstrap (sessiz yeniden oturum), TLS skip-verify (reqwest), client item-detail parity (expiry/tags), tags + notifications API hooks. ✅ 2026-05-19
- [x] **PR-K8S** — Kubernetes Cluster Entegrasyonu + HTML Rapor Üretimi: migration 00044/45/46 (`k8s_clusters`, `k8s_namespace` item tipi, `runs_in` rel tipi, `item_k8s_bindings`), `server/internal/k8s/` paketi (pure net/http client, kubeconfig parser), `admin_k8s.go` (CRUD+test+`decryptClusterConfig` helper), `k8s_proxy.go` (5 item-bazlı proxy endpoint), `admin_report.go` + `report.html.tmpl` (self-contained HTML, bounded goroutine pool), router+main wiring, web: admin-k8s.ts + reports.ts + pages/admin/k8s-clusters.tsx + pages/admin/reports.tsx + App.tsx routes + app-shell nav items. ✅ 2026-05-23
- [ ] **PR-N3** — Onay Workflow / Dual Control: `access_requests` tablosu. Kritik item için erişim isteği → admin onayı → zaman-sınırlı görüntüleme. WS event'lar. **Büyük iş — Faz 6+ ayrı plan gerekir.**

### 🎯 Önerilen Sonraki Adaylar (Devolutions analizi + öncelik sırası)

> Devolutions Server karşılaştırması sonrası yeniden önceliklendirme yapıldı (2026-05-19).
> Detaylı karşılaştırma tablosu ve "kopyalanabilir" analizi için PROGRESS.md'ye bakınız.

**Zorunlu / Teknik borç:**
- [x] **WS origin prod config** — `ENVANTER_WS_ALLOWED_ORIGINS` env var eklendi. WSHandlers.AllowedOrigins wired. ✅ 2026-05-19
- [x] **PR-F3 (Tauri Sync)** — KeyringBootstrap + TLS skip-verify + client item-detail parity. ✅ 2026-05-19
- [x] **PR-SEC1 (TOTP per-user + Login UX + QR)** — `users.totp_required` flag, 3-dallı login akışı, web/client login UX paritesi (dialog), QR render, admin per-user toggle. ✅ 2026-05-19
- [x] **PR-SEC2 (First-login forced TOTP gate)** — Bootstrap admin & yeni kullanıcılar için PWD değiş → TOTP setup zorunlu redirect. `must_setup_totp` flag + `MustSetupTOTPGate`. ✅ 2026-05-22 (PR-SEC1 ile birlikte tamamlandı)
- [x] **PR-SEC3 (mTLS Client Certificate)** — Built-in CA + external CA upload, per-user `requires_client_cert`, Ingress mTLS forward. ✅ 2026-05-22 (server/internal/clientcert/ + admin_client_certs.go uygulandı)

**Kolay kazanımlar — Devolutions'dan ilham (günler):**
- [x] **Log forwarding** — Audit log event'larından Syslog (UDP/TCP) + Slack webhook entegrasyonu. SOC/SIEM için kritik. ✅ 2026-05-22 (server/internal/logfwd/ + admin_log_forwarding.go + migration 00038 + web UI)
- [x] **Scheduled export** — `GET /api/v1/admin/export?format=json|csv` endpoint. Admin Dashboard'da JSON/CSV butonları. ✅ 2026-05-19
- [x] **Zaman bazlı erişim** — `item_shares` + `folder_permissions`'a `valid_from TIMESTAMPTZ`, `valid_until TIMESTAMPTZ` alanları. `ResolveItemPermission` CTE'ye `AND (valid_until IS NULL OR valid_until > NOW())` eklenir. Migration + UI. ✅ 2026-05-22 (PR-TIME, migration 00040)
- [x] **Item arama iyileştirmesi** — `name_plain TEXT` kolonu + `ILIKE '%query%'` substring + global cross-folder search. ADR-0011. ✅ 2026-05-22 (PR-SEARCH, migration 00039)

**Orta vadeli — kritik gaplar (hafta):**
- [ ] **SSO / OIDC entegrasyonu** — Azure AD (Entra ID) ve Okta. Kurumsal ortamlarda AD zorunlu; bu olmadan enterprise satışı güç. SAML 2.0 + OIDC. Backend: `POST /auth/sso/callback` + `users.external_id` kolonu. Önce Entra ID, sonra Okta.
- [ ] **PR-N3 (Onay/Checkout Workflow)** — Kritik credential erişimi → onay isteği → admin onayı → zaman-sınırlı görüntüleme. `access_requests` tablosu. WS event'lar. Büyük iş, ayrı plan session.
- [x] **Bağlı kayıtlar (Linked Entries)** — `item_links` tablosu, mirror/reference propagation. ✅ 2026-05-24 (PR-LINK)
- [x] **Bulk import/export** — CSV + KeePass .kdbx import sihirbazı (kdbxweb istemci-taraflı; server stdlib csv). Toplu şifreli item oluşturma, E2E guarantee. ✅ 2026-05-22 (PR-IMPORT)
- [x] **Share modal grup desteği** — `item_group_shares` tablosu + `ResolveItemPermission` 4-sinyal (owner > user share > group share > folder ACL). Frontend: paylaşım modalına "Grup" sekmesi. ✅ 2026-05-22 (PR-GROUP-SHARE)

**Uzun vadeli — büyük özellikler (ay):**
- [ ] **Otomatik parola rotasyonu** — Rotation scheduler + agent/runner ile SSH/API üzerinden credential push. Backend'de rotation policy engine. Devolutions'da PAM add-on; IronStock'ta built-in olabilir.
- [x] **WebAuthn / YubiKey MFA** — TOTP ötesi donanım anahtarı, `user_credentials` tablosu, passkey desteği. ✅ 2026-05-24 (PR-SEC4)
- [ ] **Tauri offline cache** — SQLite local cache + sync-on-connect. Ağ kesildiğinde client çalışmaya devam eder.
- [x] **CLI client** — `ironstock` komutu: credential fetch, copy-to-clipboard, script-friendly, multi-arch binary. ✅ 2026-05-24 (PR-CLI)
- [x] **Vault backend (PR-VAULT)** — HashiCorp Vault proxy tamamlandı. ✅ 2026-05-22
- [ ] **OIDC SSO** — Azure AD / Okta / Keycloak (yukarıdaki kısa vadeli sonrası genişletme).
- [ ] **Mobile client** — Tauri 2 mobile (iOS/Android).
- [ ] **Terraform provider** — IaC ile envanter yönetimi.

**Kopyalanmayacak (misyon dışı):**
- Session recording (video/stream — çok büyük altyapı)
- RADIUS authentication (niche)
- JIT privilege elevation (tam PAM ürünü kapsamı; IronStack için erken)

### ✅ Faz 11 — Production Readiness

#### ✅ PR-PROD1: CI Security Scanning Automation — merged `5ead7a7`

- [x] `.github/workflows/security.yml` — gosec, govulncheck, trivy, npm audit, cargo audit, semgrep, gitleaks, checkov/kubesec; SARIF upload GitHub Security tab
- [x] `.github/dependabot.yml` — weekly Go/npm/actions updates
- [x] Pre-commit hooks: gitleaks + gofmt + golangci-lint + eslint

#### ✅ PR-PROD2: Test Coverage Uplift — merged `291f3c5`

- [x] `server/internal/httpapi/admin_k8s_test.go` — compile guard (ListClusters/CreateCluster/UpdateCluster/DeleteCluster/TestCluster) + auth/validation tests (121 lines)
- [x] `server/internal/httpapi/k8s_proxy_test.go` — compile guard (SetBinding/GetBinding/ListPods/ListDeployments/ListServices/ListEvents/ListMetrics) + namespace validation mirror (169 lines)
- [x] `server/internal/httpapi/admin_report_test.go` — compile guard + item count validation + mirror functions (mirrorFormatTime/mirrorSeverityClass/mirrorMetricPercent) (251 lines)
- [x] `server/internal/clientcert/clientcert_test.go` — real ECDSA cert generation, 5 test scenarios, error sentinels (215 lines)

#### ✅ PR-PROD3: E2E Test Suite — merged `1faaea1`

- [x] `e2e/playwright.config.ts` — workers=1, chromium+firefox, 60s timeout, 30min global timeout
- [x] `e2e/tests/global-setup.ts` — healthz wait + bootstrap + storageState save
- [x] `e2e/tests/fixtures.ts` — adminPage + apiToken fixtures + helper functions
- [x] 10 spec files: 01-bootstrap-admin → 10-pipeline-editor (39 total tests)
- [x] `deploy/compose/docker-compose.e2e.yml` — ephemeral stack (tmpfs, offset ports)
- [x] `.github/workflows/e2e.yml` — push:main + nightly schedule + playwright-report artifact
- [x] `Makefile` — e2e-up/e2e-down/e2e/e2e-ui targets

#### [~] PR-PROD4: UX Polish & Bug Bash — DEVAM EDİYOR

**Tamamlanan bileşenler (staged, commit bekliyor):**
- [x] `web/src/components/ui/empty-state.tsx` — role="status", icon, title, description, CTA button, size variants (sm/default)
- [x] `web/src/components/layout/skip-link.tsx` — WCAG 2.4.1 Bypass Blocks, "Ana içeriğe atla", focus:top-0 geçiş
- [x] `web/src/hooks/use-document-title.ts` — WCAG 2.4.2 Page Titled, "${title} — IronStock" format, cleanup on unmount
- [x] `web/src/components/onboarding/onboarding-tour.tsx` — 4-adım tour, localStorage dismiss, focus trap, ESC key, progress dots, backdrop click

**Kalan entegrasyon işleri (sonraki session):**
- [ ] `web/src/App.tsx` — `<SkipLink />` AppShell öncesine ekle; `<OnboardingTour>` + `useOnboardingTour` hook
- [ ] `web/src/components/layout/app-shell.tsx` — `id="main-content"` main content'e; Help menu → `onboardingTour.reopen()`
- [ ] `web/src/pages/inventory/index.tsx` — `<EmptyState>` (item/klasör yoksa); `useDocumentTitle('Envanter')`
- [ ] Tüm admin sayfaları — `useDocumentTitle('Admin / ...')` + boş liste EmptyState
- [ ] `web/src/pages/admin/users.tsx`, `audit-log.tsx` — axe-core ARIA fix'leri
- [ ] Dark/light mode screenshot diff + responsive breakpoint kontrol
- [ ] Lighthouse Performance 90+, Accessibility 95+ hedef

#### [ ] PR-PROD5: Performance Testing & SLO

- [ ] k6 yük testi senaryoları (login burst, search, WS 1000 bağlantı, rapor üretimi)
- [ ] `go tool pprof` CPU+memory profil
- [ ] `pg_stat_statements` N+1 query tespiti
- [ ] `docs/ops/slo.md` — p95 < 200ms, p99 < 500ms, WS < 100ms, login < 2s, 99.9% availability

#### [ ] PR-PROD6: Dokümantasyon Tamamlama

- [ ] `docs/user-guide/` — son kullanıcı kılavuzu
- [ ] `docs/admin-guide/` — admin kılavuzu
- [ ] `docs/ops-guide/` — operatör kılavuzu (deploy, backup, monitoring)
- [ ] `docs/api/` — OpenAPI 3.1 full sync + Swagger UI serve
- [ ] `docs/integrations/` — Ansible, Terraform, browser extension, MCP, CLI
- [ ] `docs/security/` — threat model, crypto details, audit log fields
- [ ] `docs/adr/` — tüm major kararlar güncel

#### [ ] PR-PROD7: Disaster Recovery + Backup

- [ ] `scripts/backup.sh` — `pg_dump` + MinIO mirror + S3 upload
- [ ] `scripts/restore.sh` — clean cluster restore
- [ ] `deploy/k8s/cronjob-backup.yaml` — günlük otomatik yedek
- [ ] `docs/ops/backup.md`, `docs/ops/restore.md`, `docs/ops/disaster-recovery.md`
- [ ] Shamir secret sharing escrow prosedürü → ADR-0012
- [ ] Quarterly restore drill runbook

### ⏸ Ertelenen (Deferred)

- [ ] **PR-RT-2** — SSE fallback (WS bloklu kurumsal ağlar için)
- [x] **PR-RT-3** — Redis pub/sub (horizontal scale) ✅ 2026-05-24 (PR-SCALE)
- [ ] **PR-RT-4** — Per-user WS event routing (meta-leak azaltma)

### Observability
- [x] Prometheus metrics (custom + runtime) — PR-K4
- [x] Grafana dashboard template — PR-K4
- [ ] Structured logging (slog) + log aggregation uyumu

### Ops
- [ ] Backup/restore prosedürü + cron
- [ ] KMS entegrasyonu (master_keys rotation batch job)

### External Secret Backends (ADR-0007) ✅ 2026-05-22 (PR-VAULT)
- [x] `server/internal/vault` — HTTP client + k8s AppRole auth (PR-VAULT)
- [x] Item detail endpoint genişletme: `external_source` doluysa Vault passthrough
- [x] Audit log integration — `item.vault_fetch` / `item.vault_fetch_error` (metadata only, no plaintext)
- [x] Web + client UI: "Vault-backed item oluştur" formu + key_mapping editor + 30sn auto-clear
- [ ] **Parking lot:** Dynamic secrets flow (`POST /items/:id/dynamic-cred` → Vault'tan 15dk'lık cred)
- [ ] **Parking lot:** AWS Secrets Manager / Azure Key Vault (`external_source.type = "aws_sm"`)
- [ ] **Parking lot:** OIDC SSO (Vault + IronStock ortak kimlik)

### Release
- [x] Production readiness checklist — PR-V1
- [x] v1.0.0 release — 2026-04-28 ✅

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
- ~~Paylaşım linkleri (geçici, token-based, TTL'li erişim)~~ → ✅ **PR-N5 tamamlandı** (2026-05-16)
- ~~Item versioning / change history görüntüleme~~ → ✅ **PR-N2 tamamlandı** (2026-05-16)
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
