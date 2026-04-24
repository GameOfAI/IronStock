# CI Workflows

## ci.yml — Ana CI

Her push ve pull request'te çalışır.

### Jobs

| Job | Kapsam | Süre (yaklaşık) |
|-----|--------|-----------------|
| `server` | Go: gofmt + go mod tidy + golangci-lint + build + test -race + coverage | ~2-3 dk |
| `pre-commit` | Whitespace, YAML/JSON parse, merge conflict, gitleaks (secret tarama) | ~30 sn |

### Faz'a göre eklenecek job'lar

- **Faz 2** → `server-integration`: testcontainers-go ile Postgres integration test
- **Faz 3** → `web`: Vite build + ESLint + Vitest
- **Faz 4** → `client`: Tauri build (Win + Mac matrix) + Rust clippy + Vitest
- **Faz 5** → `deploy`: Helm lint + chart package + release build

### Branch protection önerisi

`main` branch için:
- Required status checks: `server`, `pre-commit` (ve Faz 3+ eklendiğinde `web`, `client`)
- Require PR reviews
- Dismiss stale reviews on push
- Require branches to be up to date
