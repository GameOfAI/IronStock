# IronStock Desktop

<p>
  <a href="https://github.com/GameOfAI/IronStock/releases/latest"><img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" /></a>
  <a href="https://github.com/GameOfAI/IronStock/releases/latest"><img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS" /></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Rust-backend-000000?logo=rust&logoColor=white" alt="Rust" />
</p>

Native desktop application for IronStock. Full vault access with client-side E2E encryption, offline mode, and system tray integration.

---

## Download

| Platform | Format | Link |
|----------|--------|------|
| Windows | `.msi` installer | [Download](https://github.com/GameOfAI/IronStock/releases/latest) |
| macOS | `.dmg` universal (Intel + Apple Silicon) | [Download](https://github.com/GameOfAI/IronStock/releases/latest) |

---

## Features

- **Zero-knowledge encryption** &mdash; X25519 + AES-256-GCM client-side. Server never sees plaintext.
- **Offline mode** &mdash; encrypted IndexedDB cache with outbox for pending writes. Works without connectivity.
- **Auto-sync** &mdash; WebSocket real-time updates with automatic reconnection.
- **Inactivity lock** &mdash; auto-locks after 15 minutes, clears private key from RAM.
- **System tray** &mdash; quick access from taskbar/menu bar.
- **Auto-updater** &mdash; server-based update checking and installation.
- **Screen capture protection** &mdash; content protection API prevents screenshots.
- **mTLS support** &mdash; client certificate authentication with .p12 picker.
- **Multi-factor auth** &mdash; TOTP and WebAuthn/FIDO2 support.
- **Connection gate** &mdash; graceful offline/reconnect UX.

---

## Architecture

```mermaid
graph TD
    subgraph tauri["Tauri 2 (Rust)"]
        builder["lib.rs\nTauri Builder"]
        tray["tray-icon plugin"]
        updater["tauri-plugin-updater"]
        keyring["keyring\nOS keychain"]
        commands["Rust Commands\ncache, content protection"]
    end

    subgraph frontend["React Frontend"]
        router["React Router\nAuthGate + ConnectionGate"]
        
        subgraph pages["Pages"]
            login["Login"]
            inventory["Inventory"]
            config["Settings"]
            totp["TOTP Setup"]
        end

        subgraph state["Zustand Stores"]
            auth["auth\nprivateKey + tokens"]
            conn["connection\nWS state"]
            pending["pending-ops\noffline outbox"]
        end

        subgraph crypto["Crypto"]
            argon2["Argon2id"]
            x25519["X25519"]
            aes["AES-256-GCM"]
        end
    end

    builder --> frontend
    frontend --> tauri
    inventory --> crypto
    auth --> crypto
```

---

## E2E Encryption Flow

```mermaid
sequenceDiagram
    participant User
    participant App as Desktop App
    participant Crypto as lib/crypto.ts
    participant Server as Go API

    Note over User,Server: Registration
    User->>App: Enter master password
    App->>Crypto: Argon2id(password, salt) → user_key
    App->>Crypto: Generate X25519 keypair
    App->>Crypto: AES-GCM(private_key, user_key) → encrypted
    App->>Server: POST /auth/register {public_key, private_key_enc}

    Note over User,Server: Login
    User->>App: Enter password
    App->>Crypto: Argon2id(password, salt) → user_key
    App->>Server: POST /auth/login
    Server-->>App: access_token + private_key_enc
    App->>Crypto: Decrypt private_key → hold in RAM
    
    Note over User,Server: Read Item
    App->>Server: GET /items/:id
    Server-->>App: metadata + wrapped DEK + encrypted fields
    App->>Crypto: X25519 unwrap DEK with private_key
    App->>Crypto: AES-GCM decrypt fields with DEK
    App-->>User: Show plaintext values

    Note over User,Server: Write Item
    App->>Crypto: Generate random 256-bit DEK
    App->>Crypto: AES-GCM encrypt field values with DEK
    App->>Crypto: X25519 wrap DEK with public_key
    App->>Server: POST /items {encrypted fields + wrapped DEK}
```

---

## Offline Mode

```mermaid
flowchart TD
    Start([App Launch]) --> Check{"Connected?"}

    Check -->|Yes| Fetch["Fetch from API\nTanStack Query"]
    Fetch --> Cache["Write encrypted\nto IndexedDB"]
    Cache --> Show["Display to user"]

    Check -->|No| ReadCache["Read encrypted\nfrom IndexedDB"]
    ReadCache --> Decrypt["Decrypt with\nprivate_key (RAM)"]
    Decrypt --> Show

    Show --> Listen["Listen for\nWebSocket events"]
    Listen -->|"item updated"| Fetch

    Show --> Write["User edits item"]
    Write --> Outbox["Queue in\npending-ops outbox"]
    Outbox --> Sync["Sync when\nconnection restored"]
```

---

## Application State Machine

```mermaid
stateDiagram-v2
    [*] --> ConnectionCheck: App opens

    ConnectionCheck --> Offline: Server unreachable
    Offline --> ConnectionCheck: Retry

    ConnectionCheck --> AuthCheck: Connected

    AuthCheck --> Login: No token / expired
    AuthCheck --> TOTPSetup: TOTP not enrolled
    AuthCheck --> App: Authenticated

    Login --> TOTPSetup: TOTP required
    Login --> App: Login successful
    TOTPSetup --> App: TOTP complete

    App --> InactivityLock: 15 min idle
    InactivityLock --> Login: privateKey cleared from RAM

    App --> [*]: App closed
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/store/auth.ts` | `privateKey`, `accessToken`, `user` &mdash; app-wide auth state |
| `src/lib/crypto.ts` | `openDEKWithKEK`, `decryptField`, `encryptField`, `fromBase64` |
| `src/api/client.ts` | Fetch wrapper with 401 auto-refresh |
| `src/api/ws.ts` | WebSocket with heartbeat + reconnection |
| `src/components/inventory/item-detail.tsx` | DEK unwrap, field display, clipboard auto-clear (30s) |
| `src/components/inventory/item-form-modal.tsx` | E2E encrypted field creation |
| `src/routes/auth-gate.tsx` | Auth + TOTP state checking |
| `src/routes/connection-gate.tsx` | Server reachability gate |
| `src/hooks/use-inactivity-lock.ts` | Auto-lock on idle |
| `src-tauri/src/lib.rs` | Tauri builder + plugin registration |

---

## Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| `tray-icon` | System tray icon and right-click menu |
| `tauri-plugin-updater` | Server-based auto-update |
| `keyring` | OS keychain integration for optional token persistence |

---

## Development

### Prerequisites

- **Node.js** 20+
- **Rust** 1.75+ (for Tauri)
- **Windows:** MS Build Tools + WebView2
- **macOS:** Xcode CLI tools (`xcode-select --install`)

### Setup

```bash
cd client
npm install

# Dev mode (opens Tauri window with HMR)
npm run tauri:dev

# Frontend only (no Tauri)
npm run dev

# Tests
npm test

# Lint + type check
npm run lint && npx tsc -b
```

### Release Build

```bash
npm run tauri:build

# Output: src-tauri/target/release/bundle/
#   Windows: .msi (NSIS installer)
#   macOS:   .dmg (Universal binary)
```

---

## Project Structure

```
client/
├── src/                          # React frontend
│   ├── pages/                    # Login, inventory, config, admin
│   ├── components/               # Inventory, layout, UI
│   ├── api/                      # REST + WebSocket clients
│   ├── lib/                      # Crypto, WebAuthn, utilities
│   ├── store/                    # Zustand (auth, connection, pending-ops)
│   ├── hooks/                    # Inactivity lock, offline sync
│   └── routes/                   # Auth gate, connection gate
├── src-tauri/                    # Rust backend
│   ├── src/lib.rs                # Tauri builder + commands
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # App config (IronStock, 1200x800)
│   ├── capabilities/             # Permission scoping
│   └── icons/                    # App icons
├── package.json
└── vite.config.ts
```
