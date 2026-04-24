# Envanter — Desktop Client (Tauri)

Windows + macOS için native desktop uygulaması. Rust (src-tauri) + React/TypeScript (src) ile yazılıyor.

## Geliştirme

Gereksinimler:
- Node 20+
- Rust 1.75+ (rustup ile yükle)
- Platform-spesifik build bağımlılıkları: https://tauri.app/v1/guides/getting-started/prerequisites/
  - Windows: MS Build Tools + WebView2
  - macOS: Xcode CLI tools

```bash
npm install
npm run tauri:dev        # Geliştirme modu (live reload, devtools açık)
npm run tauri:build      # Production bundle (MSI / .dmg)
```

## Scripts

| Komut | Ne yapar |
|-------|----------|
| `npm run dev` | Sadece Vite (webview olmadan frontend geliştirme) |
| `npm run tauri:dev` | Tauri + Vite beraber (asıl geliştirme akışı) |
| `npm run tauri:build` | Platform-spesifik bundle |
| `npm run lint` | ESLint (TS/TSX) |
| `cd src-tauri && cargo clippy` | Rust lint |
| `cd src-tauri && cargo test` | Rust unit test |

## Dizin

```
client/
├── src/                # React + TS frontend
│   ├── main.tsx
│   └── App.tsx
├── src-tauri/          # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs     # Entrypoint
│   │   └── lib.rs      # Library (Tauri Builder)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── index.html
├── vite.config.ts
└── package.json
```

## Durum

**Faz 0 iskeleti.** Gerçek feature'lar Faz 4'te:
- Server connection config
- Auth (login + MFA + master key derive)
- Envanter ağaç UI (KeePassXC tarzı)
- WebSocket live sync
- Şifrelenmiş offline cache (SQLCipher)
- Client-side E2E şifreleme

## İkonlar

Faz 4 öncesi `src-tauri/icons/` altında şu dosyalar eklenmeli:
- `32x32.png`, `128x128.png`, `128x128@2x.png` (Linux/genel)
- `icon.icns` (macOS)
- `icon.ico` (Windows)

Referans: https://tauri.app/v1/guides/features/icons/
