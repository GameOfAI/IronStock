---
name: ironstock-conventions
description: IronStock projesine özgü kod konvensiyonları — naming, commit formatı, test zorunlulukları ve tracking dosyası kuralları. Go/TypeScript/Rust yazan her session'da aktif olur.
---

# IronStock Konvensiyonları

## Naming

| Katman | Kural |
|--------|-------|
| Go package | Tek kelime, kısa (`auth`, `db`, `crypto`) |
| Go dosya | `snake_case` (`user_service.go`) |
| Rust | `snake_case` dosya ve modül |
| TypeScript dosya | `camelCase`; React component → `PascalCase` (`UserList.tsx`) |
| SQL | `snake_case` tablo/kolon |
| API path | `kebab-case` (`/api/v1/inventory-items`) |
| Env var | `SCREAMING_SNAKE_CASE` (`ENVANTER_DB_URL`) |

## Formatter & Linter

| Dil | Formatter | Linter |
|-----|-----------|--------|
| Go | `gofmt` | `golangci-lint` |
| Rust | `rustfmt` | `clippy -D warnings` |
| TypeScript | `prettier` | `eslint` |

- Indent: Go=tab, Rust=4 space, TS/JS=2 space, YAML=2 space
- Line endings: LF (Windows dahil), UTF-8, dosya sonu newline

## Commit Formatı (Conventional Commits zorunlu)

```
<type>(<scope>): <özet>

feat(server): add TOTP enrollment endpoint
fix(client): resolve websocket reconnect loop
chore(ci): bump Go version to 1.23
docs(adr): add security-model ADR
refactor(web): extract crypto helpers
```

- `main` branch her zaman deploy edilebilir olmalı
- CI yeşil olmadan merge yasak
- Force push `main`'e yasak

## Test Zorunlulukları

- **Public API, business logic, crypto fonksiyonu → test olmadan merge edilmez**
- Go: unit test + `testcontainers-go` ile gerçek Postgres (mock değil)
- TypeScript/React: Vitest + React Testing Library
- Rust: Cargo unit test
- Coverage hedefi: genel %70+, auth/crypto path'ler %90+
- Integration testler `_integration_test.go` suffix'iyle ayrı tutulur

## Tracking Dosyası Kuralı

Her feature/fix commit'i şu dosyaları **aynı commit içinde** günceller:

| Dosya | Ne zaman |
|-------|----------|
| `PROGRESS.md` | Her tamamlanan task |
| `TODO.md` | Tamamlanan `[x]`, yeni task eklenir |
| `CLAUDE.md` | Kalıcı karar değiştiyse |
| `RULES.md` | Yeni kural çıktıysa |
| `docs/adr/` | Mimari karar değiştiyse |
| `shared/api/openapi.yaml` | API kontratı değiştiyse |

**İstisna:** Yalnızca typo/doc düzeltmesi olan commit'ler tracking güncellemesi yapmaz.

## Branch Naming

```
feat/<konu>
fix/<konu>
chore/<konu>
docs/<konu>
refactor/<konu>
```

## Kod Yorum Kuralı

- Yorum sadece **neden** yazılır, **ne** yapıldığı değil
- İyi: `// chi Timeout middleware Hijack ile uyumsuz, bu yüzden /ws dışarıda`
- Kötü: `// WebSocket handler'ı çağırır`
