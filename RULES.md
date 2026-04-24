# Geliştirme Kuralları

Proje boyunca uyulacak konvensiyonlar ve kurallar. Yeni kural çıktıkça buraya eklenir, `PROGRESS.md`'ye not düşülür.

## Git ve Versiyonlama

- **Branch naming:** `feat/<konu>`, `fix/<konu>`, `chore/<konu>`, `docs/<konu>`, `refactor/<konu>`
- **Commit mesajı:** [Conventional Commits](https://www.conventionalcommits.org/) formatı
  - `feat(server): add TOTP enrollment endpoint`
  - `fix(client): resolve websocket reconnect loop`
  - `chore(ci): bump Go version to 1.23`
  - `docs(adr): add security-model ADR`
- `main` branch her zaman **deploy edilebilir** durumda olmalı.
- Her merge öncesi CI yeşil olmalı. Kırık CI ile merge yasak.
- Force push `main`'e yasak.

## Kod Kalitesi

| Dil | Formatter | Linter |
|-----|-----------|--------|
| Go | `gofmt` | `golangci-lint` (config: `.golangci.yml`) |
| Rust | `rustfmt` | `clippy -D warnings` |
| TypeScript / JS | `prettier` | `eslint` |
| SQL | — | `sqlfluff` (ileride) |

- Line endings: **LF** (Windows'ta dahil).
- Encoding: **UTF-8**.
- Indent: Go=tab, Rust=4 space, TS/JS=2 space, YAML=2 space.
- Dosya sonunda newline zorunlu.

## Test

- **Zorunlu:** Yeni public API, business logic, crypto fonksiyonu **test'siz merge edilmez**.
- **Server:** Unit test + `testcontainers-go` ile integration test (gerçek Postgres, mock değil).
- **Client:** Rust unit test + Vitest frontend.
- **Web:** Vitest + React Testing Library.
- **Coverage hedefi:** %70+ genel, kritik path (auth, crypto) %90+.
- Integration testler `_integration_test.go` suffix'i ile ayrı tutulur, CI'da ayrı job'da çalışır.

## Güvenlik

- **Secret field'lar** (parola, token, private key, TOTP seed) hiçbir zaman plaintext log'lanmaz. Struct tag ile `log:"-"` işaretlenir veya ayrı DTO kullanılır.
- **Error mesajları** internal detay leak etmez (stack trace user'a dönmez).
- **Tüm dış input** validation edilir — struct tag'lerle veya explicit check ile.
- **Dependency audit** haftalık: `govulncheck ./...`, `cargo audit`, `npm audit`.
- **TLS zorunlu** — üretim'de HTTP redirect'li.
- **Rate limit** auth endpoint'lerinde (login, TOTP verify, password reset).
- **CSRF** web UI'da (SameSite cookie + token).
- **JWT** kısa ömürlü access (15dk) + rotating refresh (7 gün).

## Dokümantasyon

- Her **mimari karar** → `docs/adr/NNNN-baslik.md` formatında ADR.
- Her **yeni public API** → `shared/api/` içindeki OpenAPI spec güncellenir.
- **Breaking change** → `CHANGELOG.md` (Faz 5'te eklenir) + migration notu.
- Kodda yorum: **neden** yazılır, **ne** yapıldığı değil.

## Süreç

- Her **task bitiminde** `PROGRESS.md` güncellenir (en az bir satır).
- Yeni task çıktığında `TODO.md`'ye eklenir.
- Yeni kural ortaya çıktığında bu dosyaya eklenir, `PROGRESS.md`'de not düşülür.
- Faz bitiminde:
  1. Tüm task'lar `DONE` işaretli.
  2. CI yeşil.
  3. `PROGRESS.md`'de faz tamamlandı entry'si.
  4. Sonraki faz task'ları TodoWrite'a yüklenir.

## Claude Code ile Çalışma

- **Dil:** Türkçe.
- **Planlama:** Koda başlamadan önce plan üzerinde mutabık kalınır.
- **Autonomous:** Basit ve geri alınabilir işler (dosya oluşturma, edit) onaysız yapılabilir. Destructive işler (silme, force push, prod config) daima onay ister.
- **Her session başında:** `CLAUDE.md`, `PROGRESS.md`, `TODO.md` okunur.
- **Her session sonunda:** İlgili md dosyaları güncellenir.

## Naming Convention

- **Go package:** snake_case değil, tek kelime kısa (örn: `auth`, `db`, `crypto`).
- **Go dosya:** snake_case (`user_service.go`).
- **Rust:** snake_case dosya ve modül.
- **TypeScript:** camelCase dosya, PascalCase component (`UserList.tsx`).
- **SQL:** snake_case table/column.
- **API path:** kebab-case (`/api/v1/inventory-items`).
- **Env var:** SCREAMING_SNAKE_CASE (`ENVANTER_DB_URL`).

## Versiyonlama

- **SemVer** — `MAJOR.MINOR.PATCH`.
- API path'inde `/api/v1/` — breaking change olursa `/v2/`.
- Client + server versiyon uyumluluk matrisi `docs/compat.md` (Faz 5).
