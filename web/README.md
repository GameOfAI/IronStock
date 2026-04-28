# Web (Admin UI)

React 18 + TypeScript + Vite tabanlı admin paneli.
Kullanıcı yönetimi, audit log izleme ve tam envanter görüntüleme/düzenleme içerir.

---

## Sayfa Yapısı

```mermaid
graph TD
    App["App.tsx\nReact Router"]

    App --> AG["AuthGate\ntoken + TOTP kontrolü"]
    AG --> Login["pages/login.tsx\nGiriş formu"]
    AG --> TOTP["pages/totp-setup.tsx\nMFA kayıt sihirbazı"]
    AG --> Recover["pages/recover.tsx\nParola kurtarma"]

    AG --> Shell["layout/app-shell.tsx\nsidebar + topbar"]

    Shell --> Inv["pages/inventory/index.tsx\nEnvanter görünümü"]
    Shell --> AdminIdx["pages/admin/index.tsx\nYönetici paneli"]
    Shell --> Users["pages/admin/users.tsx\nKullanıcı yönetimi"]
    Shell --> AuditLog["pages/admin/audit-log.tsx\nAudit log viewer"]

    Inv --> FolderTree["inventory/folder-tree.tsx"]
    Inv --> ItemList["inventory/item-list.tsx"]
    Inv --> ItemDetail["inventory/item-detail.tsx"]

    Users --> UserTable["admin/user-table.tsx"]
    Users --> UserActions["admin/user-actions-menu.tsx"]
    AuditLog --> AuditFilters["admin/audit-filters.tsx"]
    AuditLog --> AuditRow["admin/audit-row.tsx"]
```

---

## Kimlik Doğrulama Akışı

```mermaid
sequenceDiagram
    participant U as Kullanıcı
    participant W as Web UI
    participant S as Server

    U->>W: Kullanıcı adı + parola gir
    W->>S: POST /auth/login
    S-->>W: access_token + refresh_token + totp_required

    alt TOTP gerekli
        W->>U: TOTP kodu sor
        U->>W: 6 haneli kod
        W->>S: POST /auth/totp/verify
        S-->>W: yeni access_token
    end

    W->>W: Token kaydet (memory + sessionStorage)
    W->>W: AuthGate geçti → App Shell göster

    Note over W,S: Token yenileme (arka planda)
    W->>S: POST /auth/refresh
    S-->>W: yeni access_token
```

---

## API Katmanı

```mermaid
flowchart LR
    Component --> Hook["useQuery / useMutation\nTanStack Query"]
    Hook --> ApiFn["api/*.ts fonksiyonları"]
    ApiFn --> Client["api/client.ts\nfetch + auto-refresh"]
    Client --> Server["Go API Server"]

    WS["api/ws.ts\nWebSocket"] --> WSProv["ws-provider.tsx\ncontext + event dispatch"]
    WSProv --> Hook
```

`api/client.ts` 401 aldığında `/auth/refresh` ile token yeniler; başarılıysa orijinal isteği tekrarlar.

---

## Admin Kullanıcı Yönetimi Akışı

```mermaid
sequenceDiagram
    actor A as Admin
    participant W as Web UI
    participant API as Go API
    participant DB as PostgreSQL

    A->>W: Kullanıcılar sayfasını aç
    W->>API: GET /admin/users?page=1
    API->>DB: users JOIN roles sayfalı
    API-->>W: [{id, username, role, status, last_login}]
    W-->>A: Tablo göster

    A->>W: Kullanıcı devre dışı bırak
    W->>W: DisableConfirmDialog göster
    A->>W: Onayla
    W->>API: POST /admin/users/:id/disable
    API->>DB: users SET disabled=true
    API->>DB: sessions DELETE (aktif tokenlar iptal)
    API->>DB: audit_log INSERT
    API-->>W: 204 No Content
    W->>W: TanStack Query cache invalidate
    W-->>A: Tablo güncellendi
```

---

## Audit Log Görünümü

```mermaid
flowchart LR
    subgraph filters["Filtreler (audit-filters.tsx)"]
        DF["Tarih aralığı\ndate picker"]
        UF["Kullanıcı\ndropdown"]
        AF["Eylem tipi\nauth.login · item.create · ..."]
    end

    filters -->|"query params değişti"| Query["useAuditLog hook\nTanStack Query"]
    Query -->|"GET /admin/audit"| API["Go API\nsayfalı + filtrelenmiş"]
    API --> Rows["AuditRow × N\nzaman · kullanıcı · eylem · hedef"]
    Rows --> Pag["Pagination\ncommon/pagination.tsx"]
```

---

## Bileşen Katmanları

### Admin Bileşenleri (`components/admin/`)

| Bileşen | Açıklama |
|---------|---------|
| `user-table.tsx` | Sayfalı kullanıcı listesi — durum, rol, son giriş |
| `user-actions-menu.tsx` | Dropdown: rol değiştir, devre dışı bırak, parola sıfırla |
| `audit-filters.tsx` | Tarih aralığı + kullanıcı + eylem filtresi |
| `audit-row.tsx` | Log satırı — zaman, kullanıcı, eylem, hedef kaynak |
| `role-badges.tsx` | Renk kodlu rol etiketi (admin / editor / viewer) |
| `status-badge.tsx` | Kullanıcı durumu etiketi (aktif / devre dışı) |

### Envanter Bileşenleri (`components/inventory/`)

| Bileşen | Açıklama |
|---------|---------|
| `folder-tree.tsx` | Genişletilebilir ağaç — inline yeni klasör + izin yönetimi |
| `item-list.tsx` | Seçili klasörün item'ları — arama + sıralama |
| `item-detail.tsx` | Sağ panel: meta + şifreli alanlar + ekler + paylaşım |
| `item-form-modal.tsx` | Yeni item / düzenle — tip seçimi + alan girdileri |
| `item-share-modal.tsx` | Kullanıcı paylaşımı — DEK yeniden wrap |
| `item-attachment-panel.tsx` | Presigned URL ile upload/download |
| `permission-badge.tsx` | `read` / `write` etiketi |

### UI Bileşenleri (`components/ui/`)

shadcn/ui tabanlı 17 primitive: `alert-dialog`, `badge`, `button`, `card`, `checkbox`, `collapsible`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `select`, `skeleton`, `table`, `toast`, `toaster`, `tooltip`.

---

## Geliştirme

```bash
cd web

# Bağımlılıklar
npm install

# Dev sunucu (localhost:5173)
npm run dev

# Testler (Vitest + React Testing Library)
npm test

# Tip kontrolü
npx tsc -b

# Lint
npm run lint

# Production build
npm run build
# Çıktı: dist/ — k8s nginx pod'una serve edilir
```

### Ortam Ayarları

| Değişken | Açıklama | Varsayılan |
|---------|---------|---------|
| `VITE_API_URL` | Go API base URL | `http://localhost:8080` |
| `VITE_WS_URL` | WebSocket URL | `ws://localhost:8080/ws` |
