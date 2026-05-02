# Client (Tauri Desktop)

Windows ve macOS için native desktop uygulaması.
Tauri 2 (Rust) + React 18 + TypeScript yapısı. Client-side E2E şifreleme, offline cache ve system tray desteği içerir.

---

## Mimari

```mermaid
graph TD
    subgraph tauri["Tauri 2 (Rust — src-tauri/)"]
        rust_core["lib.rs\nTauri Builder"]
        tray["tray-icon plugin"]
        updater["tauri-plugin-updater"]
        keyring["keyring\nsistem anahtar deposu"]
    end

    subgraph frontend["Frontend (src/)"]
        router["React Router\nAuthGate · ConnectionGate"]

        subgraph pages_grp["Pages"]
            login["login.tsx"]
            inventory["inventory.tsx"]
            config["config.tsx"]
            totp["totp-setup.tsx"]
        end

        subgraph state["State (Zustand)"]
            auth_store["store/auth\nprivateKey · accessToken"]
            conn_store["store/connection\nWS durum"]
            ui_store["store/ui"]
        end

        subgraph api_grp["API Layer"]
            http_client["api/client.ts\nfetch wrapper + token refresh"]
            ws_client["api/ws.ts\nWebSocket client"]
            crypto_lib["lib/crypto.ts\nArgon2id · X25519 · AES-GCM"]
        end

        subgraph inv_comp["Inventory Components"]
            folder_tree["folder-tree.tsx"]
            item_list["item-list.tsx"]
            item_detail["item-detail.tsx\nDEK unwrap + field decrypt"]
            item_form["item-form-modal.tsx\nE2E field encrypt"]
            attach["item-attachment-panel.tsx"]
        end
    end

    rust_core --> frontend
    frontend --> tauri
    auth_store --> crypto_lib
    item_detail --> crypto_lib
    item_form --> crypto_lib
```

---

## Uygulama Durum Makinesi

```mermaid
stateDiagram-v2
    [*] --> ConnectionCheck: Uygulama açılır

    ConnectionCheck --> Offline: Sunucu erişilemiyor
    Offline --> ConnectionCheck: Yeniden dene

    ConnectionCheck --> AuthCheck: Bağlantı var

    AuthCheck --> Login: Token yok / süresi dolmuş
    AuthCheck --> TOTPSetup: TOTP kayıtlı değil
    AuthCheck --> App: Kimlik doğrulandı

    Login --> TOTPSetup: TOTP gerekli
    Login --> App: Başarılı giriş
    TOTPSetup --> App: TOTP tamamlandı

    App --> InactivityLock: 15 dk hareketsizlik
    InactivityLock --> Login: privateKey RAM'den silindi

    App --> [*]: Uygulama kapatıldı
```

---

## Sayfa Akışı

```mermaid
flowchart LR
    Start([Uygulama açılış]) --> CG{ConnectionGate}
    CG -->|sunucu yok| Offline[Offline gösterge]
    CG -->|bağlandı| AG{AuthGate}
    AG -->|token yok| Login[Login Sayfası]
    AG -->|TOTP eksik| TOTP[TOTP Setup]
    AG -->|giriş tamam| Inv[Envanter Sayfası]
    Login -->|başarılı| Inv
    Inv --> Detail[Item Detail\notomatik DEK çözümleme]
    Inv --> Config[Ayarlar Sayfası]
```

---

## Inventory Sayfası Bileşen Ağacı

```mermaid
graph TD
    InvPage["pages/inventory.tsx"]

    InvPage --> FT["FolderTree\nsol panel"]
    InvPage --> IL["ItemList\norta panel"]
    InvPage --> ID["ItemDetail\nsağ panel"]

    FT --> FTN["FolderTreeNode\nözyinelemeli"]
    FTN --> FFM["FolderFormModal\nyeni/düzenle"]
    FTN --> FDD["FolderDeleteDialog"]

    IL --> IS["ItemSearch\ndebounce 300ms"]
    IL --> PB["PermissionBadge"]
    IL --> IFM["ItemFormModal\nyeni item"]

    ID --> FR["FieldRow × N\nblur + copy + 30sn timer"]
    ID --> IAP["ItemAttachmentPanel\npresign upload/download"]
    ID --> RT["RelativeTime\ncreated_at / updated_at"]

    IL -->|"seçim"| ID
    FT -->|"klasör seçimi"| IL

    ID -->|"DEK unwrap"| CL["lib/crypto.ts"]
    IAP -->|"presign URL"| API["api/attachments.ts"]
```

---

## E2E Şifreleme (Client Tarafı)

```mermaid
sequenceDiagram
    participant U as Kullanıcı
    participant App as Uygulama
    participant Crypto as lib/crypto.ts
    participant Server as Go API

    Note over U,Server: Kayıt
    U->>App: Master parola gir
    App->>Crypto: Argon2id(parola, salt) → user_key
    App->>Crypto: X25519 keypair üret
    App->>Crypto: AES-GCM(private_key, user_key) → private_key_enc
    App->>Server: POST /auth/register {public_key, private_key_enc}

    Note over U,Server: Login
    U->>App: Parola gir
    App->>Crypto: Argon2id(parola, salt) → user_key
    App->>Server: POST /auth/login
    Server-->>App: access_token + private_key_enc
    App->>Crypto: AES-GCM decrypt(private_key_enc, user_key) → private_key
    App->>App: private_key RAM'de sakla (store/auth)

    Note over U,Server: Item okuma
    App->>Server: GET /items/:id
    Server-->>App: metadata + owner_dek_wrapped + field_enc[]
    App->>Crypto: X25519 unseal(owner_dek_wrapped, private_key) → DEK
    App->>Crypto: AES-GCM decrypt(field_enc, DEK) → plaintext[]
    App-->>U: Alan değerlerini göster

    Note over U,Server: Item yazma
    App->>Crypto: random 256-bit DEK üret
    App->>Crypto: AES-GCM encrypt(field_value, DEK) → field_enc
    App->>Crypto: X25519 seal(DEK, public_key) → dek_wrapped
    App->>Server: POST /items {metadata, field_enc[], dek_wrapped}
```

---

## Offline Cache Akışı

```mermaid
flowchart TD
    Start([Uygulama başladı]) --> Check{"Bağlantı\nvar mı?"}

    Check -->|Evet| Fetch["API'den veri çek\nTanStack Query"]
    Fetch --> Cache["IndexedDB'ye şifreli yaz\nDEK ile"]
    Cache --> Show["Kullanıcıya göster"]

    Check -->|Hayır| ReadCache["IndexedDB'den\nşifreli oku"]
    ReadCache --> Decrypt["RAM'deki\nprivate_key ile çöz"]
    Decrypt --> Show

    Show --> WS["WebSocket\nolaylarını dinle"]
    WS -->|"item güncellendi"| Fetch
```

---

## Temel Dosyalar

| Dosya | Açıklama |
|-------|---------|
| `src/store/auth.ts` | `privateKey`, `accessToken`, `user` — uygulama geneli auth durumu |
| `src/lib/crypto.ts` | `openDEKWithKEK`, `decryptField`, `encryptField`, `fromBase64` |
| `src/api/client.ts` | Fetch wrapper — 401'de otomatik token yenileme |
| `src/api/ws.ts` | WebSocket bağlantısı + heartbeat + yeniden bağlanma |
| `src/components/inventory/item-detail.tsx` | DEK çözme, alan görüntüleme, pano temizleme (30sn) |
| `src/components/inventory/item-form-modal.tsx` | Yeni/düzenle modal — şifreli field yazma |
| `src/routes/auth-gate.tsx` | Auth + TOTP durumu kontrolü |
| `src/routes/connection-gate.tsx` | Sunucu erişilebilirlik kontrolü |
| `src/hooks/use-inactivity-lock.ts` | Hareketsizlik sonrası otomatik kilit |

---

## Kurulum ve Derleme

```bash
cd client

# Bağımlılıklar
npm install

# Dev modu (Tauri penceresiyle)
npm run tauri:dev

# Sadece frontend dev
npm run dev

# Release build
npm run tauri:build
# Çıktı: src-tauri/target/release/bundle/
#   Windows: .msi (NSIS installer)
#   macOS:   .dmg (Universal — arm64 + x86_64)

# Testler
npm test

# Lint + tip kontrolü
npm run lint && npx tsc -b
```

Platform gereksinimleri:
- **Windows:** MS Build Tools + WebView2
- **macOS:** Xcode CLI tools (`xcode-select --install`)

---

## Tauri Eklentileri

| Eklenti | Kullanım |
|---------|---------|
| `tray-icon` | System tray simgesi ve sağ-tık menüsü |
| `tauri-plugin-updater` | Otomatik güncelleme (sunucu tabanlı) |
| `keyring` | OS anahtar deposu — opsiyonel token kalıcılığı |
