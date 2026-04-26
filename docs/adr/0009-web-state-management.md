# 0009 — Web Client State Management & Foundation Stack

- **Durum:** Accepted
- **Tarih:** 2026-04-27
- **Karar veren:** Burak Haşlaman + paralel Claude session'lar (Win + Mac M4)
- **İlişkili:** [ADR-0001](0001-tech-stack.md) web admin satırı, [ADR-0002](0002-security-model.md) §"Client-side E2E", [ADR-0004](0004-encryption-details.md) §"Argon2id KEK"

## Bağlam

Faz 3 — Admin Web UI başlıyor. 8 PR planlı (Win + Mac paralel iş bölümü). React + Vite + TypeScript iskeleti Faz 0'dan beri var ama state management, server caching, styling ve client-side cryptography stack'i henüz seçilmedi.

Karara etki eden boyutlar:
- **Server state**: REST + WebSocket. List/detail cache + WS event'iyle invalidation gerekiyor (folder/item lifecycle).
- **Client state**: Auth context (kek + private_key memory-only), tema, sidebar collapsed, seçili klasör.
- **Bundle bütçesi**: Pro paket token ekonomisi → kütüphane sayısını minimize et.
- **Client-side şifreleme (PR-W5)**: Argon2id (KEK türetme), X25519 (DEK wrap), AES-GCM (field encrypt). WebCrypto eksik kalan kısmı (Argon2id) için WASM gerekecek.
- **OpenAPI sync**: PR-11 sadece minimal sync yaptı (tag eklemeleri); tam request/response schema Faz 3 sonu polish PR'ında. Yani şimdi **manuel TypeScript tipleri** ile gidiyoruz, sonra `schema.gen.ts`'e geçiş düşük maliyetle yapılabilir bir karar olmalı.

## Karar

### 1. State Management — Zustand + TanStack Query (hibrit)

**Server state** → **TanStack Query** (`@tanstack/react-query`):
- Cache + stale-while-revalidate + background refetch built-in.
- `queryClient.invalidateQueries(['items', folderId])` — WS event handler'ından temiz invalidation.
- Suspense desteği → loading state atomik.
- DevTools panel (`@tanstack/react-query-devtools`).

**Client/UI state** → **Zustand** (`zustand`):
- Auth store: `accessToken`, `refreshToken`, `user`, `kek`, `privateKey`. **kek + privateKey memory-only** (localStorage'a yazılmaz).
- UI store: `theme` ('light' | 'dark' | 'system'), `sidebarCollapsed`.
- ~1.5KB, hook-based, Redux DevTools opt-in (`zustand/middleware`).

**Toplam:** ~14KB (Zustand + TanStack Query). Redux Toolkit (RTK Query dahil) ~25KB+'a karşılık.

**Pattern (PR-W1'de Win kuracak):**
```
src/api/
├── client.ts        — fetch wrapper + token storage + refresh interceptor + error mapping
├── types.ts         — manuel DTO tipleri (Faz 3 polish PR'ında schema.gen.ts'e taşınır)
├── auth.ts          — useLogin, useRefresh, useLogout, useRecover hooks
├── folders.ts       — useFolders, useFolder, useCreateFolder, ...
├── items.ts         — useItems, useItem, useCreateItem, useShareItem
├── admin.ts         — useUsers, useAuditLog
└── catalog.ts       — useFieldDefinitions, useItemTypes

src/store/
├── auth.ts          — Zustand auth state (memory-only kek + priv)
└── ui.ts            — Zustand UI state
```

`client.ts` raw `fetch` döner. Hook'lar (`useFolders` vb.) TanStack Query'nin `useQuery`/`useMutation` ile sarar. Refresh rotation logic `client.ts` interceptor'ında — 401 + `invalid_token` → `/auth/refresh` → retry; başarısızsa logout. `reuse_detected` özel olarak yakalanır → tüm session'lar revoke, full logout.

### 2. Styling — Tailwind 4 + shadcn/ui

- **Tailwind 4** (utility-first CSS). Dark mode CSS variables ile native (light/dark toggle).
- **shadcn/ui** (MIT, copy-paste model — kendi `src/components/ui/` altına kopyalanır). Bağımlılık şişmesi yok, kontrol bizde.
- **lucide-react** (icon set, ~tree-shakable).
- **WAI-ARIA** kutudan hazır (Radix UI primitives üzerinde).

PR-W1'de Win pre-install edecek componentler: Button, Input, Label, Card, Dialog, Toast/Toaster, Table, Select, Skeleton. Sonraki PR'larda `npx shadcn add <component>` ile genişler.

KeePassXC tarzı 3-panel layout (folder tree + item list + detail panel) için yeterince esnek. Form/modal/select primitive'leri PR-W3/W4/W5 için tam karşılık.

### 3. Client-side Cryptography — argon2-browser + WebCrypto + @noble/curves

- **argon2-browser** (WASM Argon2id) — KEK türetme. WebCrypto Argon2id desteklemiyor.
- **WebCrypto SubtleCrypto** — AES-256-GCM (field encrypt/decrypt, private_key_enc decrypt).
- **@noble/curves** veya WebCrypto X25519 — sealed-box (DEK wrap için). WebCrypto X25519 desteği Chrome 113+ / Firefox 130+ olduğu için fallback olarak `@noble/curves` (3KB, audit edilmiş pure JS) kullanılabilir.

**KEK akışı (PR-W2 Login flow):**
1. `POST /api/v1/auth/login` → `{access_token, refresh_token, user}`.
2. `GET /api/v1/users/me/keypair` (PR-12, Win ekleyecek) → `{public_key, private_key_enc, kek_salt, kek_params}`.
3. `argon2id(master_password, kek_salt, kek_params)` → `KEK (32B)`.
4. `AES-GCM-decrypt(private_key_enc, KEK)` → `private_key (32B X25519)`.
5. `authStore.setSession({ user, accessToken, refreshToken, kek, privateKey })`.

`useAuth()` context: `{ user, kek, privateKey }` — memory-only. Logout / refresh failure → store `clear()` → memory wipe.

PR-W5 (item create/edit/share) bu store'dan `kek + privateKey` okur.

### 4. WebSocket Authentication — Sec-WebSocket-Protocol Subprotocol

Browser `WebSocket` API'si custom header gönderemediğinden, RFC 6455 subprotocol mekanizması abuse edilir:

```ts
const ws = new WebSocket('/api/v1/ws', [`bearer.${accessToken}`]);
```

Server `Sec-WebSocket-Protocol` header'ından `bearer.` prefix'li subprotocol'ü parse eder, JWT validate eder, response'da aynı subprotocol'ü echo eder. PR-10'da server-side handler iskeleti hazır; PR-W6'da Win subprotocol parse'ı ekleyecek. Bu ADR'in kararı olarak kalır — alternatif (`?access_token=` query param) URL log leak nedeniyle reddedildi.

PR-W3/W4 (Mac) WS olmadan ilerler — manual refresh fallback button. PR-W6'da realtime invalidation eklenir.

### 5. Toolchain Detayları (PR-W1 kuracak)

- `tailwindcss` + `@tailwindcss/vite` + `tailwindcss-animate`
- `lucide-react` (icons)
- `class-variance-authority` + `clsx` + `tailwind-merge` (`lib/cn.ts` helper)
- `components.json` (shadcn config)
- `theme.tsx` (light/dark CSS vars + ThemeProvider)
- React Router v6 (auth-gate, nested routes)
- Vitest + `@testing-library/react` + `@testing-library/user-event`

## Reddedilen Alternatifler

**RTK Query / Redux Toolkit** — Reddedildi. Boyutlandırma RTK Query bundle'ı + Redux store boilerplate'i bu proje ölçeğinde gereksiz overhead. TanStack Query 2025+ React'te defacto, daha az boilerplate, daha küçük bundle.

**Vanilla `useState` + `Context`** — Reddedildi. Cache invalidation manuel olur, WS event handler ile etkileşim yorucu, network state (loading/error/refetch) her endpoint'te tekrar yazılır.

**MUI / Ant Design** — Reddedildi. Bundle ağır (~250-500KB), tasarım dili lock-in, dark mode CSS vars'a entegrasyon zorlu.

**Server-side Argon2id türetme** — Reddedildi. Server KEK'i görürse client-side E2E modeli çöker (ADR-0002 §"Client-side E2E").

**`?access_token=` query param (WS)** — Reddedildi. URL ingress / proxy / browser geçmişi loglarına düşer.

**Login response'a keypair embed** — Reddedildi. Login akışı zaten kompleks (TOTP + lockout + session); payload şişmemeli. Yeni `GET /api/v1/users/me/keypair` endpoint (PR-12).

## Sonuçlar

**Olumlu:**
- Bundle ~14KB (state) + Tailwind treeshaken + shadcn copy-paste → kontrollü ve küçük.
- WS event invalidation tek satır: `queryClient.invalidateQueries(['items', folderId])`.
- KEK + private_key memory-only → güvenlik modeline tam uyum.
- Manuel TS tipleri → schema.gen.ts'e geçiş düşük maliyet (sadece import path değişir).

**Olumsuz / Risk:**
- `argon2-browser` WASM ~50KB ek bundle (login akışında bir kez load edilir, lazy import).
- WebCrypto X25519 tarayıcı uyumluluğu için fallback `@noble/curves` test edilmeli.
- TanStack Query DevTools production'da disable edilmeli (Vite `import.meta.env.PROD` guard).

**Faz 5 follow-up:**
- `schema.gen.ts` üretimi (oapi-codegen TypeScript pipeline) — manuel DTO'ları otomatikleştir.
- Service Worker ile background refetch optimizasyonu (offline support değerlendirmesi).
