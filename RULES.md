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

## CI Disiplini

> Bu kurallar GitHub Actions için yazılmıştır; repo şirket CI/CD'sine taşındığında
> eşdeğer kontroller orada da uygulanmalıdır.

### Migration numarası çakışması

- Yeni migration eklerken `server/migrations/` içindeki **en büyük numarayı** kontrol et:
  ```bash
  ls server/migrations/ | sort | tail -3
  ```
- Paralel branch'lerde aynı numara alınabilir — merge öncesi `ls | grep "^0006[0-9]"` ile
  tüm migration'ların numaralarının unique olduğu doğrulanır.
- **`mv` ile dosya taşırken `git mv` kullan** — plain `mv` + `git add <yeni>` yaptığında
  eski dosya index'te kalır ve CI'da duplicate version hatası verir.

### Go versiyonu senkronizasyonu

- `go.work`, `server/go.mod` ve CI workflow'undaki `go-version` **aynı minor'da** olmalı
  (örn. `1.25.x`). Biri güncelleniyor sa diğerleri de aynı anda güncellenir.
- `go work sync` local Go versiyonuna göre farklı checksum üretebilir.
  CI farklı bir Go minor kullanıyorsa `go.work.sum` / `go.sum` checksum uyuşmazlığı çıkar —
  çözüm: CI'ın Go versiyonunu local'e eşit tut veya CI ortamında `go mod tidy` çalıştır.

### npm / Node — lockfile yokluğunda peer dep güvencesi

- `package-lock.json` platform-specific binary içerdiğinden gitignore'da. Bu nedenle Docker
  ve bazı CI adımları **her build'de fresh resolve** yapar.
- Fresh resolve'da kırılmama kuralları:
  1. **Peer dep çakışması varsa** (örn. ESLint 10 + eski plugin) root `package.json`'daki
     `overrides` ile kısıt koy; Dockerfile/CI'a `--legacy-peer-deps` ekleme (hack'tir,
     son çare).
  2. **Bundler'ın opsiyonel/peer dep'leri** (Vite 8 → esbuild) explicit `devDependencies`'e
     yazılır — "zaten gelir" sayılmaz.
  3. Her yeni major npm paketi eklenince `npm install && npm run build` Docker
     içinde test edilir (`docker build ./web`).

### Branch'ten main'e merge sonrası CI

- `main`'e merge yapıldıktan sonra CI **aynı gün** yeşillendirilir; kırık bırakılmaz.
- Merge sonucu kırmızı CI ile gece bırakılırsa ertesi session hangi fix'in ne kırdığını
  takip etmek zorlaşır.

## Repo Konumu

- **GitHub:** `https://github.com/GameOfAI/IronStock`
- Claude tüm dosya işlemlerini proje kökünden (`IronStock/`) yapar.
- Yeni session: repo kökünde (`IronStock/`) Claude Code açılırsa working directory doğru olur.

### Push öncesi tracking dosyaları kontrolü (zorunlu — otomatik zorlanır)

> **Karar kaynağı:** ADR-0012 (docs/adr/0012-development-tracking-discipline.md)
> **Otomasyon:** `scripts/check-tracking-files.sh` pre-commit hook ile zorlanır.
> **Kurulum:** `pip install pre-commit && pre-commit install` (tek seferlik)

Bir feature/fix/chore commit'i, ilgili tracking dosyalarını **aynı commit içinde** güncel tutmalıdır:

| Dosya | Ne zaman güncellenir | Asgari zorunluluk |
|-------|---------------------|-------------------|
| `PROGRESS.md` | Her feature/fix tamamlanması | En az 1 satır: ne yapıldı, nerede duruldu |
| `TODO.md` | Tamamlanan task / çıkan yeni task | Tamamlanan `[x]` işaretlenir, yeni task eklenir |
| `CLAUDE.md` | Kalıcı karar değişti / yeni boyut eklendi | Sadece kalıcı bağlam değiştiyse |
| `RULES.md` | Yeni kural ortaya çıktı | Yeni kural eklenir |
| İlgili ADR (`docs/adr/`) | Mimari karar değişti | Yeni ADR yazılır veya mevcut "Superseded by" işaretlenir |
| `docs/diagrams/er.mmd` | Şema değişikliği | Yeni tablo/kolon yansıtılır |
| `shared/api/openapi.yaml` | API kontratı değişti | Spec güncellenir, code gen tetiklenir |

**Kural:** Tracking güncellemesi **ayrı "docs" commit'i değil**, asıl iş commit'inin içinde olur.

**İstisna:** Sadece typo / küçük doc düzeltmesi yapan commit'ler tracking güncellemesi yapmaz (örn: `docs: fix typo in README`).

**Meşru bypass** (WIP / kısmi commit / format düzeltmesi):
```bash
SKIP_TRACKING_CHECK=1 git commit -m "wip: ..."
```

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
