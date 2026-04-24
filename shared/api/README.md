# Shared API Contract

Bu dizin **server, web ve client'ın ortak kullandığı tip ve kontrat kaynağı**.

## Kanonik Kaynak

```
openapi.yaml   # OpenAPI 3.1 spec — single source of truth
```

Bu dosya el ile yazılır. Değişiklik yapılırsa:
1. `openapi.yaml` güncellenir.
2. Code gen çalıştırılır (bkz. aşağıda).
3. Server + web + client commit'ine dahil edilir (aynı PR'da).

## Generated Code (gitignored)

```
generated/
├── go/          # Server — oapi-codegen output (Faz 2'de eklenecek)
└── ts/          # Web + Client — openapi-typescript output (Faz 3/4'te)
```

**Asla manuel düzenleme yok.** Her build'de yeniden üretilir.

## Code Generation (planned — Faz 2+)

### Go (server)
```bash
# oapi-codegen ile handler interface'leri + request/response modelleri
go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
oapi-codegen -config shared/api/codegen/oapi-codegen-server.yaml shared/api/openapi.yaml
```

Output: `shared/api/generated/go/server.go` — chi handler interface'leri.

### TypeScript (web + client)
```bash
npx openapi-typescript shared/api/openapi.yaml -o shared/api/generated/ts/schema.ts
```

Output: `shared/api/generated/ts/schema.ts` — request/response tipler.

Kullanım (client code):
```ts
import type { paths } from '@envanter/api-types';

type LoginRequest = paths['/api/v1/auth/login']['post']['requestBody']['content']['application/json'];
type LoginResponse = paths['/api/v1/auth/login']['post']['responses']['200']['content']['application/json'];
```

## OpenAPI Validation

Spec'in valid olduğunu doğrula:

```bash
# Redocly lint (en kapsamlı)
npx @redocly/cli lint shared/api/openapi.yaml

# veya Spectral
npx @stoplight/spectral-cli lint shared/api/openapi.yaml
```

CI'da (Faz 2'de eklenir) bu lint ahead of merge doğrulanır.

## Faz 1 Kapsamı

Mevcut spec'te:
- Health: `/healthz`, `/readyz`
- Auth: register, TOTP init/verify, login, refresh, logout, logout-all, change-password, recover/init, recover/complete

## Faz 2'de Eklenecek Endpoint'ler

- Users admin: CRUD
- Roles: grant/revoke
- Folders: CRUD (tree ops: move, list children)
- Items: CRUD + search + share
- WebSocket endpoint: `/ws` — gerçek zamanlı değişiklik event'leri (muhtemelen ayrı ASyncAPI spec)
- Audit log: GET filtering

## OpenAPI Editor Desteği

- **VS Code**: "OpenAPI (Swagger) Editor" eklentisi → live preview + autocomplete.
- **CLI preview**: `npx @redocly/cli preview-docs shared/api/openapi.yaml`

## Versiyonlama

- API path prefix `/api/v1/`. Breaking change → `/api/v2/` (paralel serve edilir, v1 deprecation window).
- OpenAPI `info.version` → semver, her release'de bump.
- Schema değişikliği (rename, required field ekleme) = breaking → major bump.
- Yeni endpoint / yeni opsiyonel field = minor bump.
- Doküman düzeltmesi = patch bump.
