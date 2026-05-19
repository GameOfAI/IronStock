# İlerleyiş

Son güncelleme: 2026-05-19 (Devolutions rekabet analizi + olgunluk güncellemesi)

## Mevcut Durum

- **Aktif Faz:** Post-v1.0.0 Kapsamlı Geliştirmeler (Faz 6+)
- **Tamamlanan Faz:** Faz 0 + 1 + 2 + 3 + 4 + 5 ✅
- **Son tamamlanan:** Item tam alan düzenleme + WS proxy/origin fix + renkli telemetri dot + CI test düzeltmeleri ✅ 2026-05-18
- **Proje durumu:** MVP + kapsamlı geliştirmeler devam ediyor. PR-UX5'e kadar tüm planlı PR'lar tamamlandı. Kalan zorunlu: PR-F3 (Tauri Sync), PR-N3 (Onay Workflow). Yeni yön: PAM özellikleri (Devolutions analizi sonrası — bakınız aşağıdaki rekabet analizi).

---

## Uygulama Olgunluk Özeti (2026-05-19)

### Credential Vault Özellikleri — Karşılaştırmalı Tablo

| Özellik | IronStock | Devolutions Server | Not |
|---------|-----------|-------------------|-----|
| Self-hosted deployment | ✅ k8s | ✅ Windows/Linux IIS | IronStock daha cloud-native |
| E2E client-side şifreleme | ✅ AES-GCM + X25519 | ❌ server-side only | **IronStock kritik avantaj** |
| Credential CRUD | ✅ | ✅ | Eşit |
| Dinamik alan tipleri | ✅ field_definitions | ✅ | Eşit |
| Klasör/hiyerarşi | ✅ | ✅ multi-vault | Devolutions vault'ları ayrı; IronStock klasör-bazlı |
| RBAC (rol tabanlı) | ✅ 3 katman | ✅ | Eşit |
| Grup bazlı ACL | ✅ | ✅ AD/LDAP groups | Devolutions'da AD entegrasyonu var |
| TOTP / MFA | ✅ TOTP RFC 6238 | ✅ TOTP+YubiKey+SMS+Duo+RADIUS | Devolutions daha geniş MFA |
| SSO / OIDC | ❌ (parking lot) | ✅ Entra ID / Okta / PingOne | **IronStock'ta yok — önemli gap** |
| Güvenilir cihaz | ✅ 30 gün cookie | ✅ | Eşit |
| Audit log | ✅ | ✅ + Syslog/Slack/SIEM forward | Devolutions log forwarding var |
| Bildirim sistemi | ✅ in-app + WS | ✅ | Eşit |
| Etiket sistemi | ✅ | ❌ (tag yok) | **IronStock avantaj** |
| Item versiyonlama | ✅ 10 versiyon | ❌ | **IronStock avantaj** |
| Expiry / rotation takibi | ✅ + scanner | ❌ (sadece RDM entegrasyonu) | **IronStock avantaj** |
| One-time share link | ✅ E2E | ❌ | **IronStock avantaj** |
| Pipeline/lifecycle görselleştirme | ✅ ReactFlow | ❌ | **IronStock benzersiz özellik** |
| İlişki haritası (graph) | ✅ | ❌ | **IronStock benzersiz özellik** |
| Native client (Tauri) | ✅ Windows+macOS | ✅ RDM (ayrı ücretli ürün) | IronStock'ta ücretsiz dahil |
| Tauri offline cache | ❌ | ✅ RDM local cache | **IronStock'ta yok** |
| Otomatik parola rotasyonu | ❌ | ✅ PAM add-on | **IronStock'ta yok — önemli gap** |
| Session kaydı | ❌ | ✅ | **IronStock'ta yok** |
| Secure session brokering | ❌ (ilişki türü var ama brokering yok) | ✅ Devolutions Gateway | **IronStock'ta yok — büyük gap** |
| JIT privilege elevation | ❌ | ✅ PAM add-on | **IronStock'ta yok** |
| Onay/checkout workflow | ⏳ PR-N3 planlı | ✅ | Planlı |
| Zaman bazlı erişim | ❌ | ✅ | **IronStock'ta yok** |
| GeoIP kısıtlama | ❌ | ✅ | **IronStock'ta yok** |
| Programatik erişim (API/CLI) | ✅ REST API | ✅ REST + PowerShell | Eşit seviye |
| Toplu import/export | ❌ | ✅ PowerShell scheduled export | **IronStock'ta yok** |
| Log forwarding (Syslog/SIEM) | ❌ | ✅ Syslog, Slack, Sentinel | **IronStock'ta yok** |
| Linked entries (bağlı kayıtlar) | ❌ | ✅ | **IronStock'ta yok** |
| Break-glass acil erişim | ✅ + WS alert | ❌ | **IronStock avantaj** |
| Prometheus metrics | ✅ | ❌ | **IronStock avantaj** |
| Veritabanı | PostgreSQL | MSSQL | IronStock bağımsız, MSSQL lisans maliyeti yok |
| Fiyatlandırma | İçeride geliştirme (maliyet yok) | Per-seat ticari lisans | IronStock avantaj |

### IronStock'un Net Güçlü Yanları
1. **Client-side E2E şifreleme** — Devolutions'da yok. Server plaintext'i asla görmez. Bu kritik bir güven farklılığı.
2. **Kubernetes-native** — Devolutions Windows Server + IIS bağımlı. IronStock cloud-agnostic.
3. **PostgreSQL** — MSSQL lisans maliyeti ve bağımlılığı yok.
4. **Item versiyonlama + expiry tracking** — Devolutions'da credential lifecycle takibi zayıf.
5. **Pipeline/lifecycle görselleştirme** — Pazarda benzeri yok. DevOps için özgün değer.
6. **One-time E2E share link** — Devolutions'da yok.
7. **Break-glass + anlık uyarı** — Devolutions'da yok.
8. **Prometheus/Grafana** — Gözlemlenebilirlik built-in.
9. **Etiket + favori sistemi** — Devolutions'da yok.

### IronStock'un Kapatması Gereken Önemli Gaplar
1. **SSO/OIDC (Azure AD/Okta)** — Kurumsal ortamlarda AD/Entra ID zorunlu. En acil gap.
2. **Otomatik parola rotasyonu** — Scheduler var ama rotasyonu fiilen yapmıyor; sadece takip ediyor.
3. **Log forwarding (Syslog/SIEM)** — SOC entegrasyonu için kritik.
4. **Tauri offline cache** — Ağ kesildiğinde client çalışmıyor.
5. **Toplu import/export** — Mevcut sistemden geçiş için şart.
6. **Zaman bazlı erişim** — "Sadece mesai saatlerinde" gibi politikalar.
7. **Onay/checkout workflow (PR-N3)** — Kritik credential'lar için dual-control.
8. **WebAuthn/YubiKey MFA** — TOTP ötesi donanım anahtarı desteği.
9. **Bağlı kayıtlar (linked entries)** — Tek şifre değişikliği tüm referansları günceller.

### Ne Kopyalanabilir (Öncelik Sırası)

**Kolay (günler — mimari değişiklik gerektirmez):**
- Log forwarding: Syslog + Slack webhook (audit log event'larından)
- Scheduled export: JSON/CSV export endpoint + cron trigger
- Zaman bazlı erişim: `item_shares`/`folder_permissions`'a `valid_from/valid_until` alanları

**Orta (hafta — yeni tablo + UI gerekir):**
- SSO/OIDC — Azure AD / Okta entegrasyonu (Entra ID önce, SAML sonra)
- Bağlı kayıtlar — `item_links` tablosu, kaynak güncellenince hedef DEK'leri de yenile
- Toplu import — CSV + KeePassXC .kdbx import parser
- Tauri offline cache — SQLite local cache + sync-on-connect

**Büyük (ay — ayrı plan gerekir):**
- Otomatik parola rotasyonu — Agent/runner ile SSH/API üzerinden credential push
- Onay/checkout workflow (PR-N3 zaten planlandı)
- WebAuthn/YubiKey MFA
- Secure session brokering (basit SSH/RDP proxy)

**Kopyalanmayacak (misyon dışı / fazla karmaşık):**
- Session recording — video/stream kaydı çok büyük altyapı gerektirir
- RADIUS authentication — niche, öncelik düşük
- JIT privilege elevation — PAM ürünü için; IronStock'un kapsamını aşıyor şimdilik

### Rekabetçi Konumlandırma Özeti
IronStock şu an **"güvenli credential vault + DevOps görselleştirme"** kesişiminde özgün bir noktada. Devolutions'un baskın olduğu alan **"session management + enterprise AD integration"**; IronStock'un baskın olduğu alan **"client-side E2E güvenlik + pipeline/lifecycle bağlamı + modern cloud-native deploy"**. İki ürün farklı müşteri ihtiyaçlarına hizmet ediyor — tam rakip değil, tamamlayıcı olabilir.

---

## Kapsamlı Geliştirme Planı — Durum Özeti (2026-05-16)

| PR | Özellik | Durum |
|----|---------|-------|
| PR-RT-1 | WS ticket endpoint (URL güvenliği) | ✅ DONE |
| PR-F1 | Default admin + must_change_password | ✅ DONE |
| PR-N6 | Read event audit logging | ✅ DONE |
| PR-F2a | TOTP Status/Disable/Backup/Admin reset | ✅ DONE |
| PR-F4 | Smart Item Type Fields (enum, multiline, number) | ✅ DONE |
| PR-F6a | Groups CRUD + folder_group_permissions | ✅ DONE |
| PR-F6b | Folder visibility (CTE grup aware) | ✅ DONE |
| PR-F6c | Groups Admin UI | ✅ DONE |
| PR-N4 | Break-Glass Emergency Access | ✅ DONE |
| PR-F2b | Trusted Device (remember 30 days) | ✅ DONE |
| PR-F5a | Graph Handler (backend) | ✅ DONE |
| PR-F5b | Graph UI (React Flow) | ✅ DONE |
| PR-N7 | Tags + Favoriler | ✅ DONE |
| PR-N8 | Notification/Alert Sistemi | ✅ DONE |
| PR-N1 | Credential Expiry / TTL + Rotation Hatırlatıcısı | ✅ DONE |
| PR-N2 | Secret Versioning (10 versiyon) | ✅ DONE |
| PR-N5 | One-Time Paylaşım Linki | ✅ DONE |
| PR-F5c | Lifecycle Stages + Assignment API | ✅ DONE |
| PR-F5d | Pipeline Diagrams CRUD API | ✅ DONE |
| PR-F5e | ReactFlow Integration + Pipeline Canvas | ✅ DONE |
| PR-F5f | Lifecycle Lanes View | ✅ DONE |
| PR-F5g | Export + Polish | ✅ DONE |
| PR-UX1 | Tema + Scrollbar + Modal layout + Pipeline node delete | ✅ DONE |
| PR-UX2 | Etiket sistemi (interactive tag picker) | ✅ DONE |
| PR-UX3 | Admin konsolidasyonu (tabbed) + TOTP sıfırlama | ✅ DONE |
| PR-UX4 | Graf tip filtresi + Lifecycle onboarding | ✅ DONE |
| PR-UX5 | Item paylaşım modalı fix (DEK re-wrap + user picker) | ✅ DONE |
| PR-F3 | Tauri Client Sync | ⏳ TODO |
| PR-N3 | Onay Workflow / Dual Control | ⏳ Faz 6+ (büyük iş) |

## Faz Durumu

| Faz | Durum | Başlangıç | Bitiş | Not |
|-----|-------|-----------|-------|-----|
| 0 — Temel kurulum | VERIFY | 2026-04-24 | 2026-04-24 | Kod yazıldı, lokal smoke test user tarafında |
| 1 — Veri modeli + kripto tasarımı | DONE | 2026-04-24 | 2026-04-24 | ER (17 tablo) + ADR 0004/0005/0006/0007 + auth-flow + 5 migration + OpenAPI + code gen |
| 2 — Server MVP | DONE | 2026-04-24 | 2026-04-26 | PR-1...PR-9 ✅ merged. 10 auth endpoint, folder/item CRUD, RBAC 3 katmanlı, E2E hibrit, 174 unit test, 17 migration. WebSocket → Faz 3, item_relationships + field/type admin → Faz 5 (parking). |
| 3 — Admin Web UI | DONE | 2026-04-26 | 2026-04-27 | 9 PR (Win 6 + Mac 3). PR-10/11/12/W1/W2/W3/W4/W5/W6 tümü merged ✅. WS client + realtime cache invalidation + responsive sidebar + A11y + E2E crypto primitives + admin/inventory UI. |
| 4 — Client MVP (Tauri) | DONE | 2026-04-27 | 2026-04-28 | PR-S1/C2/C3/C4/C5/C1 ✅ merged + PR-13 ✅ merged. PR-C6 (Win binary CI) PR#7 open — CI onayı sonrası tam kapanır. |
| 5 — Production hardening | DONE | 2026-04-28 | 2026-04-28 | PR-K1..K5 + PR-A1 + PR-A2 + PR-P1 + PR-V1 tümü merged ✅. k8s hardening, Sealed Secrets, Ingress+TLS, Prometheus+Grafana, MinIO, attachments, packaging. v1.0.0 released. |

Durumlar: `DONE` tamamlandı · `ACTIVE` devam ediyor · `PARTIAL` parçalı tamamlandı · `VERIFY` doğrulama bekliyor · `BLOCKED` bloke · `TODO` beklemede

## Faz 0 Task İlerlemesi

- [x] Monorepo dizin yapısı
- [x] Root config dosyaları (.gitignore, .editorconfig, README, LICENSE, Makefile, .env.example, go.work)
- [x] Go modülü + workspace (server/go.mod + cmd/api/main.go healthz + internal/ doc.go iskeleti)
- [x] Docker Compose dev stack (Postgres 16 + Adminer + Mailhog)
- [x] golangci-lint config (.golangci.yml) + pre-commit hook (.pre-commit-config.yaml, gitleaks dahil)
- [x] GitHub Actions CI iskeleti (server job + pre-commit job)
- [x] İlk 3 ADR (tech-stack, security-model, repo-layout) + docs/adr/README
- [x] Web (admin) iskeleti (Vite + React + TS + ESLint + Prettier)
- [x] Tauri client iskeleti (Rust src-tauri + Vite + React + TS)
- [x] Faz 0 smoke test kılavuzu (docs/smoke-test.md)
- [ ] **User aksiyonu:** Smoke test'in lokalde çalıştırılması ve CI'ın ilk push'ta yeşile gelmesi

## Faz 1 Task İlerlemesi

- [x] ER diyagram (Mermaid) — `docs/diagrams/er.mmd` (11 tablo: auth + inventory + audit + keys)
- [x] Şifreleme detayları ADR — `docs/adr/0004-encryption-details.md` (AES-256-GCM + Argon2id + X25519 + HMAC search)
- [x] Migration tool ADR — `docs/adr/0005-migration-tool.md` (goose seçimi)
- [x] Auth flow dokümantasyonu — `docs/auth-flow.md` (9 senaryo Mermaid sequence diagram)
- [x] Tasarım review — 6 karar netleşti (UUID v7, MFA mandatory, recovery=new keypair, auto-lock 10dk, searchable enc kabul, session binding=flag)
- [x] İlk 5 migration: `00001_init_extensions` + `00002_users` + `00003_roles` + `00004_sessions` + `00005_audit_log`
- [x] OpenAPI v1 taslak — `shared/api/openapi.yaml` (health + 10 auth endpoint)
- [x] Code gen pipeline: `server/sqlc.yaml` + `server/oapi-codegen.yaml` + Makefile `gen`/`gen-*` hedefleri
- [x] sqlc query örnekleri: `server/queries/{users,sessions,roles,audit_log}.sql`
- [ ] **User aksiyonu:** Lokal tool'ları kur (`make tools-install` — sqlc, oapi-codegen, goose, golangci-lint), `make gen` + `make migrate-up` çalıştır, schema'yı Adminer'da doğrula.

## Günlük

### 2026-05-18 (Win) — CI test fix'leri ✅

**Sorun:** CI #72 ve #73 başarısız oldu. İki bağımsız test hatası:

1. **`ws-provider.test.tsx` — `client.getDetail is not a function`**
   - Neden: `WsProvider`, `WsStatusDetail` döndüren `client.getDetail()` çağırmaya başladı (PR-UX5/realtime refactor'da), ancak test mock'u güncellenmemişti.
   - Düzeltme: Mock'a `getDetail: vi.fn().mockReturnValue({ status: 'connecting', attempt: 0 })` eklendi; `_emit` de `WsStatusDetail` nesnesi geçecek şekilde güncellendi.

2. **`item-form-modal.test.tsx` — edit modunda `mutateAsync` çağrılmadı**
   - Neden: Edit save'i artık async crypto (DEK re-wrap + field encrypt) yapıyor. Test `act()` ile bekliyordu — async crypto React scheduler dışında tamamlanıyor.
   - Düzeltme: Create testi ile aynı pattern'a geçildi: `waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce(), { timeout: 3000 })`.
   - `act` import'u kaldırıldı (artık kullanılmıyor).

**Sonuç:** 25 test dosyası, 131 test — tümü geçiyor. CI #74 başarılı olmalı.

---

### 2026-05-17 (Win) — Renkli WS telemetri dot ✅

**Sorun:** WS bağlantı indikatörü her zaman dönen spinner gösteriyordu; bağlantı kurulduğunda da döndüğünden kullanıcı telemetrinin çalışıp çalışmadığını anlayamıyordu. Bağlantı kurulamazsa neden anlaşılamıyordu.

**Çözüm — `WsStatusDot` component'i yeniden yazıldı (`app-shell.tsx`):**
- **Yeşil sabit nokta** (`bg-green-500`): bağlı (connected)
- **Amber titreyen nokta** (`bg-amber-400 animate-ping`): bağlanıyor / yeniden bağlanıyor
- **Kırmızı sabit nokta** (`bg-destructive`): çevrimdışı
- **Tıklanabilir Popover:** status label, son hata mesajı (Türkçe), saniye geri sayım ("X saniye sonra tekrar denenecek"), olası nedenler listesi
- Spinner ve `WifiOff` icon kaldırıldı; sade 8px renkli daire

**Arka planda `WsStatusDetail` altyapısı:**
- `ws.ts`: `WsStatusDetail` interface (`status`, `errorReason`, `attempt`, `nextRetryIn`)
- `WsClient.onStatus` callback tipi `string` → `WsStatusDetail`
- Close code 1006/4001/4003 için Türkçe hata mesajları
- Countdown timer: `setInterval` ile `nextRetryIn` her saniye güncellenir
- `ws-provider.tsx`: `WsDetailContext` + `useWsDetail()` + `useWsStatus()` (compat shim)
- `ws.test.ts`: callback tipi güncellendi

---

### 2026-05-17 (Win) — WS proxy + origin fix ✅

**Sorun:** `localhost:5173` üzerinden WebSocket bağlantısı close code 1006 ile başarısız oluyordu. İki katmanlı problem:

1. **Vite proxy routing:** `/api/v1/ws` Vite'de `/api` (HTTP-only) kuralı tarafından yakalanıyordu — WS upgrade hiç gerçekleşmiyordu.
   - Düzeltme (`vite.config.ts`): `/api/v1/ws` için ayrı `ws: true` kural eklendi, `/api` kuralından önce.

2. **`coder/websocket` origin check:** `localhost:5173` origin'i `localhost:8080` host'una eşit değil → HTTP 403 → bağlantı 1006 ile düştü.
   - Düzeltme (`ws_handler.go`): `OriginPatterns: []string{"localhost:*", "127.0.0.1:*"}` eklendi.

**Doğrulama:** Sunucu logu `ws conn registered, total_conns: 1` mesajını gösterdi.

---

### 2026-05-17 (Win) — Item tam alan düzenleme ✅

**Sorun:** Item düzenleme modalı sadece isim/açıklama/expiry düzenlemesine izin veriyordu. Alan değerleri (şifreler, URL'ler vb.) düzenlenemiyordu — kasıtlı olarak bloke edilmişti çünkü server `owner_dek_wrapped` expose etmiyordu (PR-13 bunu çözdü). Ancak frontend bunu yakalamayı bırakmamıştı.

**Düzeltme:**

- `shared/pkg/src/api/types.ts`: `ItemUpdateRequest`'e `fields?`, `owner_dek_wrapped?`, `owner_wrap_nonce?` alanları eklendi.
- `web/src/components/inventory/item-form-modal.tsx` — edit modu yeniden yazıldı:
  - Modal açılınca: `openDEKWithKEK` + `decryptField` ile mevcut alan değerleri çözümlenir; yüklenirken "Alanlar yükleniyor..." spinner gösterilir.
  - Kaydet'e basınca: `sealDEKWithKEK(editDek, privateKey)` + tüm alanlar `encryptField` ile re-encrypt edilir + update request içinde gönderilir.
  - `editDek` state olarak saklanır (her alan için yeniden çözümleme gerekmiyor).
- `web/src/pages/inventory/index.tsx`: `editItem` prop'una tam item data geçmek için `fullItemQuery.data` kullanılıyor (DEK + encrypted fields içeren).

---

### 2026-05-17 (Win) — Lokal geliştirme ortamı düzeltmesi ✅

**Sorun:** `localhost:5173`'de HTTP 500 hatası. Vite proxy `http://server:8080` hedefine işaret ediyordu — bu hostname Docker ağı içinde çözümlenebilir, host makinesinden değil.

- **Düzeltme:** `vite.config.ts`'de `'http://server:8080'` → `'http://localhost:8080'` olarak değiştirildi.
- Birden fazla Vite process'i aynı anda çalışıyordu (5173→5174→5175 port drift); PowerShell ile kill edildi.
- Docker Compose servisleri temizlendi; k8s_* container'larının Docker Desktop Kubernetes'e ait olduğu ve docker compose ile ilgisiz olduğu belirlendi.

---

### 2026-05-17 (Win) — PR-UX1~5: Kapsamlı UI/UX İyileştirmeleri ✅

**PR-UX1 — Tema + Scrollbar + Modal + Pipeline node delete:**
- `web/src/index.css`: Webkit + Firefox özel scrollbar CSS (`@layer base`)
- ReactFlow Controls tema uyumu (CSS class override, `hsl(var(--card))` renkleri)
- `pipeline-node.tsx`: `group-hover` ile X silme butonu + `data.onRemove` callback
- `item-form-modal.tsx`: `sm:max-w-lg` → `sm:max-w-3xl`, 2-sütunlu grid layout
- Süre & Rotasyon alanlarına açıklayıcı tooltip eklendi

**PR-UX2 — İnteraktif etiket sistemi:**
- `item-tag-picker.tsx` (YENİ): Popover+Command pattern, mevcut etiketler badge olarak + × kaldır, "+" ekle, yeni etiket oluştur seçeneği
- `item-detail.tsx`: read-only badge'ler `<ItemTagPicker>` ile değiştirildi
- `/tags` sayfasında tag badge'lerine tıklama → envantere filtreli yönlendirme

**PR-UX3 — Admin konsolidasyonu + TOTP sıfırlama:**
- `admin/users.tsx`: shadcn `Tabs` bileşeni — Kullanıcılar | Gruplar | Roller, URL `?tab=` ile senkron
- Sidebar: 3 ayrı admin link → tek "Kullanıcı Yönetimi" linki
- `user-actions-menu.tsx`: "TOTP Sıfırla" menü öğesi + onay dialog
- `totp-reset-dialog.tsx` (YENİ): onay dialog + `useResetTOTPMutation` hook
- `/admin/groups` + `/admin/roles` → `/admin/users?tab=groups/roles` redirect

**PR-UX4 — İlişki haritası filtreleme + Lifecycle onboarding:**
- `/graph` sayfası: tip filtre chip'leri (Tümü/Sunucu/URL/Veritabanı/SSH/API/Genel), ReactFlow Controls tema fix
- `diagram-sidebar.tsx`: tip filtre chip'leri eklendi
- `lifecycle.tsx`: kapatılabilir onboarding banner (localStorage dismiss state)

**PR-UX5 — Item paylaşım modalı tam implementasyon:**
- `item-share-modal.tsx`: hardcoded `throw` kaldırıldı; DEK re-wrap flow (openDEKWithKEK → recipientPublicKey → sealed box)
- Raw UUID input → Combobox kullanıcı picker (`useAllUsersQuery` ile)
- `admin.ts`: `useAllUsersQuery` hook eklendi

**CI fix — PR-UX3 sonrası:**
- `user-table.test.tsx`: eksik `useResetTOTPMutation` mock'u eklendi

---

### 2026-05-17 (Win) — PR-F5g: Export + Polish ✅

**PR-F5g: PNG/SVG Export + Pipeline List Polish** ✅
- `html-to-image@^1.11.13` paketi eklendi
- `pipeline-canvas.tsx`: PNG ve SVG export butonları eklendi (toolbar'a)
  - `toPng` / `toSvg` — `.react-flow__viewport` DOM elemanına `html-to-image` uygulanır
  - `getNodesBounds` + `getViewportForBounds` ile tüm node'ları kapsayan viewport hesaplanır
  - `diagramName` prop'u ile dosya adı belirlenir (`production-pipeline.png` gibi)
  - `CanvasInnerProps` + `PipelineCanvasProps`'a `diagramName?: string` eklendi
- `diagram.tsx`: `diagramName={diagramDetail?.name}` PipelineCanvas'a geçirildi
- `pages/pipeline/index.tsx`: Header'a "Lifecycle Lanes" outline butonu eklendi (`/pipeline/lifecycle` linki)
- **Test sonucu:** 131/131 ✅ | `tsc -b` ✅ | ESLint ✅ | build ✅

**PR-F5c/d/e/f/g TAMAMLANDI** — DevOps Lifecycle Graph + Pipeline Canvas özelliği tamamen bitti.

### 2026-05-17 (Win) — PR-F5f: Lifecycle Lanes View ✅

**PR-F5f: Lifecycle Lanes Frontend** ✅
- `graph_handlers.go`: `graphResponse` struct'ına `LifecycleStages map[string][]int32` eklendi; tek SQL sorgusu ile tüm visible item'ların stage atamaları `ANY($1::uuid[])` ile çekiliyor
- `shared/pkg/src/api/types.ts`: `GraphResponse` interface'ine `lifecycle_stages: Record<string, number[]>` eklendi
- `lifecycle-lane.tsx` (YENİ): Tek lifecycle şerit bileşeni — stage header (renk+sayaç), HTML5 native drag-and-drop drop zone, item kartları (sürüklenebilir, × kaldırma butonu)
- `pages/pipeline/lifecycle.tsx` (YENİ): `/pipeline/lifecycle` route — 8 aşama yatay swimlane, "Atanmamış" öğeler alt bölüm, `LifecycleStageBridge` pattern (hook'u event handler içinde çağırma sınırlamasını aşmak için custom DOM event köprüsü), yenile butonu
- `App.tsx`: `/pipeline/lifecycle` route eklendi (`/pipeline/:id`'den önce — react-router çakışmaması)
- `app-shell.tsx`: "Lifecycle Lanes" nav linki (Layers icon) eklendi
- **Test sonucu:** 131/131 ✅ | `tsc -b` ✅ | ESLint ✅ | build ✅

**Sıradaki:** PR-F5g (Export + Polish)

### 2026-05-17 (Win) — PR-F5e: ReactFlow Integration + Pipeline Canvas ✅

**PR-F5e: ReactFlow + Dagre Pipeline Canvas (Frontend)** ✅
- `web/package.json`: `@xyflow/react@^12.3.6` + `@dagrejs/dagre@^1.0.4` eklendi
- `pipeline-constants.ts` (YENİ): `PIPELINE_TYPE_ICONS`, `PIPELINE_TYPE_LABELS`, `REL_LABELS` — react-refresh uyumluluğu için constants dosyası
- `pipeline-node.tsx` (YENİ): Custom ReactFlow node — lifecycle stage renk barı, item type icon, tür etiketi, Handle'lar
- `pipeline-edge.tsx` (YENİ): Animated bezier edge — `dashdraw` CSS animasyonu, ilişki tipi etiketi, EdgeLabelRenderer
- `pipeline-canvas.tsx` (YENİ): ReactFlow canvas — `ReactFlowProvider` + `CanvasInner` pattern, dagre LR auto-layout (konumsuz node'larda otomatik), debounced drag-stop save (1s), Background/Controls/MiniMap, toolbar (Auto Layout / Fit View / Save)
- `diagram-sidebar.tsx` (YENİ): Item picker — `useGraphQuery` ile mevcut item'lar listelenir, already-in-diagram filtreleme, search, "Ekle" + "Tümünü ekle"
- `pages/pipeline/index.tsx` (YENİ): Diyagram listesi (`/pipeline`) — CreateDiagramModal, DiagramCard, AlertDialog ile silme
- `pages/pipeline/diagram.tsx` (YENİ): Tekil diyagram sayfası (`/pipeline/:id`) — breadcrumb, stats (node/edge sayısı), sidebar + canvas
- `App.tsx`: `/pipeline` + `/pipeline/:id` route'ları eklendi
- `app-shell.tsx`: "Pipeline Diyagramları" nav linki (Network icon)
- **Pre-existing bug fix:** `apiFetch` headers+JSON.stringify sorunu (`pipeline.ts`, `graph.ts`, `lifecycle.ts`), `OnNodeDrag` tip fix, `is_break_glass` fixture eksikliği, `useRecordRotationMutation` mock eksikliği, `expect.objectContaining` fix
- **Test sonucu:** 25 dosya, 131 test ✅ all pass | `tsc -b` ✅ | ESLint ✅ | `npm run build` ✅

**Sıradaki:** PR-F5f (Lifecycle Lanes View — Frontend)

### 2026-05-17 (Win) — PR-F5c/d: DevOps Lifecycle Stages + Pipeline Diagrams Backend ✅

**PR-F5c: Lifecycle Stages + Assignment API** ✅
- Migration 00032: `lifecycle_stages` sabit katalog (8 DevOps aşaması: plan→code→build→test→release→deploy→operate→monitor) + `item_lifecycle_stages` many-to-many
- `lifecycle_handlers.go`: ListStages (GET catalog), GetItemStages (GET assigned), SetItemStages (POST upsert — delete+insert TX, write permission required)
- Router + main.go wiring
- TypeScript types: `LifecycleStage`, `LifecycleStagesResponse`, `ItemLifecycleStagesResponse`, `SetItemLifecycleStagesRequest`
- Web API hooks: `useLifecycleStagesQuery`, `useItemLifecycleStagesQuery`, `useSetItemLifecycleStagesMutation`

**PR-F5d: Pipeline Diagrams CRUD API** ✅
- Migration 00033: `pipeline_diagrams` (id, name, description, folder_id, layout_data JSONB, created_by) + `pipeline_diagram_nodes` (diagram_id, item_id, position_x/y, custom_label)
- `pipeline_handlers.go`: Full CRUD (List/Create/Get/Update/Delete) + AddNodes + RemoveNode + SaveLayout + DiagramGraph
- DiagramGraph: filtered nodes+edges (only items in the diagram) + lifecycle_stages map per item
- Ownership-based access control (owner or admin)
- Router + main.go wiring
- TypeScript types: `PipelineDiagramMeta`, `PipelineDiagramNode`, `PipelineDiagramDetail`, `DiagramGraphNode/Edge/Response`, request types
- Web API hooks: `usePipelineDiagramsQuery`, `usePipelineDiagramQuery`, `useDiagramGraphQuery`, + 5 mutation hooks

**Bug fix:** `ErrCodeForbidden` + `ErrCodeValidation` constants eklenmiş (error.go'da eksikti, graph_handlers.go kullanıyordu).

**Sıradaki:** PR-F5e (ReactFlow Integration + Pipeline Canvas — Frontend)

### 2026-05-16 (Win) — PR-F2b: Trusted Device ✅

**PR-F2b: "Bu cihazı 30 gün hatırla" (Trusted Device)** ✅
- Migration 00030: `trusted_devices` tablosu (id, user_id, token_hash BYTEA 32B UNIQUE, device_label, last_used_at, expires_at) + index
- Server helpers: `generateDeviceToken()` (32-byte random, base64url + SHA-256), `hashDeviceToken()`, `setTrustedDeviceCookie()` (HttpOnly/Secure/SameSite=Strict), `clearTrustedDeviceCookie()`, `verifyTrustedDevice()` (UPDATE + RETURNING → rolling 30-day TTL), `createTrustedDevice()`, `deviceLabelFromRequest()` (truncated UA string)
- Login flow: password OK → TOTP configured → check `trusted_device` cookie → if valid (DB hit), skip TOTP; else require code
- `remember_device: true` on login + fresh TOTP verify → issue token → set cookie → audit entry
- Handlers: `ListTrustedDevices`, `RevokeTrustedDevice`, `RevokeAllTrustedDevices` (always clears cookie)
- Router: GET/DELETE /api/v1/auth/trusted-devices, DELETE /api/v1/auth/trusted-devices/{id} (access-token required)
- Audit constants: `auth.trusted_device_created`, `auth.trusted_device_revoked`, `auth.trusted_device_used`
- Shared types: `TrustedDevice`, `TrustedDevicesResponse`; `LoginRequest.remember_device?: boolean`
- Web `auth.ts`: `useTrustedDevicesQuery`, `useRevokeTrustedDeviceMutation`, `useRevokeAllTrustedDevicesMutation`
- Web `login.tsx`: "Bu cihazı 30 gün hatırla" checkbox (shown when totpRequired phase)
- Web `profile.tsx`: `TrustedDevicesCard` — device list (label, last used, expiry), revoke individual + "tüm cihazları kaldır" AlertDialog

**Sıradaki:** PR-F3 (Tauri Sync) veya PR-N3 (Onay Workflow, Faz 5)

### 2026-05-16 (Win) — PR-N5: One-Time Share Links ✅

**PR-N5: Güvenli One-Time Paylaşım Linki** ✅

**Server:**
- Migration 00031: `item_share_links` tablosu (id, item_id, token_hash BYTEA 32B UNIQUE, dek_wrapped BYTEA, expires_at, view_limit SMALLINT 1–10, view_count SMALLINT, created_by) + index
- Audit constants: `item.share_link_created`, `item.share_link_viewed`, `item.share_link_expired`, `item.share_link_revoked`
- `ShareLinkHandlers` (DB `*pgxpool.Pool`, Service `*auth.Service`, Audit, Logger):
  - `generateShareToken()`: 32-byte random → base64url token + SHA-256 hash
  - `hashShareToken()`: base64url decode + SHA-256 (validate 32B)
  - `parseTTL()`: "1h" → 1h, "7d" → 7×24h, default 24h
  - `CreateShareLink` (POST /api/v1/items/{id}/share-links): write-perm check, store token_hash + dek_wrapped, return raw token
  - `ListShareLinks` (GET): active only (expires_at > now AND view_count < view_limit), write-perm check
  - `RevokeShareLink` (DELETE /{link_id}): write-perm check, DELETE row, audit
  - `ViewShareLink` (GET /api/v1/share/{token}): PUBLIC (no auth); `UPDATE ... SET view_count = view_count+1 WHERE ... AND expires_at > now AND view_count < view_limit RETURNING ...`; pgx.ErrNoRows → 410 Gone; async audit
  - `fetchItemForPublicShare`: joins items+item_types (server-decrypt name via master cipher), queries item_fields+field_definitions → encrypted fields
- Router: `ShareLink *ShareLinkHandlers` field added to `Deps`; 3 auth routes + 1 public route
- main.go: `shareLinkHandlers` wired into `Deps.ShareLink`

**Shared types:**
- `CreateShareLinkRequest`, `CreateShareLinkResponse`, `ShareLink`, `ShareLinksListResponse`, `ShareLinkField`, `ShareLinkViewResponse`

**Web:**
- `web/src/api/share-links.ts`: `useShareLinksQuery`, `useCreateShareLinkMutation`, `useRevokeShareLinkMutation`, `useShareLinkViewQuery` (unauthenticated, staleTime=Infinity, no auto-refetch)
- `web/src/components/inventory/share-link-dialog.tsx`: Dialog (Select TTL+view_limit, create button, generated URL + copy + open, active links list with revoke) — E2E crypto: `openDEKWithKEK` → generate 32B link_key → `encryptPrivateKey(dek, link_key)` → POST → URL with `#base64url(link_key)`
- `web/src/components/inventory/item-detail.tsx`: "Paylaşım Linki" button (write permission only, above favorite toggle)
- `web/src/pages/share.tsx`: Public page — reads link_key from `window.location.hash`, fetches payload (no auth), `decryptPrivateKey(dek_wrapped, link_key)` → item_dek → `decryptField` per secret field; show/hide + copy per field; error states (expired, missing key, DEK error); no-login required
- `web/src/App.tsx`: `/share/:token` route added to public section (outside AuthGate)

### 2026-05-16 (Win) — PR-RT-1 ✅ + PR-N8 ✅ + PR-F5a/b ✅ + PR-N4 ✅

**PR-RT-1: WS ticket endpoint (URL'de token güvenliği)** ✅
- `ws_tickets` in-memory store (`sync.Map`) — 32-byte random, 30s TTL, tek kullanım
- `POST /api/v1/ws/ticket` endpoint (Bearer auth) → ticket string döner
- WS upgrade `?ticket=` query param ile authenticate eder; token URL'ye artık gitmez
- Web `ws.ts` güncellendi: her connect attempt öncesi `fetchWsTicket()` çağrısı

**PR-N8: Notification System** ✅
- Migration 00031: `notifications` tablosu (user_id, type, title, body, resource_type, resource_id, read_at) + partial index (unread)
- Server `notify.Writer`: Write (sync, returns error) + WriteAsync (goroutine wrapper, hot-path safe)
- `NotificationHandlers`: GET /notifications, GET /notifications/unread-count, POST /notifications/read-all, POST /notifications/{id}/read
- WS event `notification.created` → bell badge anında güncellenir
- Web: `useNotificationsQuery`, `useMarkReadMutation`, `useMarkAllReadMutation`
- Web `NotificationBell` component: Popover, unread count badge (9+), okunmamış blue dot, "tümünü okundu işaretle", tr-TR timestamp

**PR-F5a/b: DevOps Pipeline İlişki Haritası** ✅
- Migration 00028: `item_rel_type_chk` genişletildi — uses_tool, builds_to, scans_with, deploys_to eklendi
- Server `GraphHandlers`: `GET /api/v1/graph` (RBAC-filtered nodes + edges), `POST /items/{id}/relationships`, `DELETE /items/{id}/relationships/{target_id}/{type}`
- Admin: tüm items; normal user: CTE (owned + directly_shared + folder ACL + group ACL)
- Shared types: RelationshipType union, GraphNode, GraphEdge, GraphResponse, AddRelationshipRequest
- Web `/graph` sayfası: node kartları (type badge + edges), relationship ekleme/silme, search, GitBranch nav item

**PR-N4: Break-Glass Emergency Access** ✅
- Migration 00029: `users.is_break_glass BOOLEAN DEFAULT false` + partial index
- Login handler: break-glass user detect edince async `emitBreakGlassAlert()` — audit + WS + notify all admins
- `POST /api/v1/admin/users/{id}/break-glass` toggle endpoint
- ListUsers response'a `is_break_glass` eklendi
- Web `BreakGlassBanner`: `break-glass:alert` DOM CustomEvent dinler, admin-only, kırmızı banner (AlertOctagon, dismiss X), son 5 alert
- WS `auth.break_glass` event → DOM CustomEvent dispatch

**Sıradaki:** PR-F2b (Trusted Device — remember 30 days)

### 2026-05-16 (Win) — PR-N7: Tags + Favorites ✅

**PR-N7: Tags + User Favorites** ✅
- Migration 00026: `tags` (id, name CHECK 1-64, color CHECK hex, created_by, UNIQUE(name,created_by)) + `item_tags` (item_id+tag_id PK) + `user_favorites` (user_id+item_id PK) tables
- Audit constants: tag.created/deleted, item.tagged/untagged, item.favorited/unfavorited
- Server `TagHandlers`: 9 endpoints — GET/POST/DELETE /tags, GET/POST/DELETE /items/{id}/tags, GET/POST/DELETE /items/{id}/favorite, GET /favorites
- Favorite toggle returns 204/404 for status polling; ListFavorites does per-row permission check + name decrypt
- Router: Tag routes mounted under /api/v1/tags, /api/v1/favorites, nested under /api/v1/items/{id}
- Shared types: Tag, TagListResponse, CreateTagRequest, AddItemTagRequest, ItemTagsResponse, FavoriteItem, FavoritesListResponse
- Web `tags.ts`: useTagsQuery, useCreateTagMutation, useDeleteTagMutation, useItemTagsQuery, useAddItemTagMutation, useRemoveItemTagMutation, useFavoritesQuery, useFavoriteStatusQuery, useAddFavoriteMutation, useRemoveFavoriteMutation
- Web `/tags` page: create tag form (name + hex color), tag list with delete AlertDialog
- Web `item-detail.tsx`: favorite star toggle (filled/outlined), tag badge chips under item header
- Web `app-shell.tsx`: "Etiketlerim" nav item with Tag icon

### 2026-05-16 (Win) — PR-N2: Secret Field Versioning ✅

**PR-N2: Item Field Value Versioning** ✅
- Migration 00025: `item_field_versions` table (id, item_field_id FK, version_number, value_enc, value_nonce, changed_at) + `idx_item_field_versions_lookup`
- PostgreSQL trigger `trg_snapshot_item_field` — fires BEFORE UPDATE ON item_fields when value_enc changes; inserts old row into versions + prunes to max 10
- Server: `GET /api/v1/items/{id}/fields/{field_def_id}/versions` → up to 10 snapshots sorted by version DESC; Read permission required
- Shared types: `FieldVersionOutput`, `FieldVersionsResponse`
- Web `items.ts`: `useFieldVersionsQuery` hook (lazy — only fetches when dialog is open)
- Web: `FieldVersionsDialog` component — History icon on hover, opens dialog with version list showing timestamps; values stay encrypted (opaque blobs shown as "Şifreli değer")
- Web `item-field-row.tsx`: history button added for secret fields (group-hover pattern), passes `itemId` prop

### 2026-05-16 (Win) — PR-N1: Credential Expiry / Rotation ✅

**PR-N1: Credential Expiry + Rotation Tracking** ✅
- Migration 00024: `items.expires_at`, `rotation_interval_days`, `last_rotated_at` + partial index
- Server: `itemRequest`/`itemResponse`/`itemRow` struct'lara expiry alanları eklendi
- SQL: CREATE/UPDATE/GET/LIST sorgularına expiry kolonları eklendi
- Server: `RecordRotation` handler — `POST /api/v1/items/{id}/rotate` → `last_rotated_at = now()`; audit `item.rotation_recorded`
- Server: background expiry scanner goroutine (hourly) — 7 gün içinde dolacak item'lar için `item.expiry_warning` WS event
- Shared types: `Item`, `ItemCreateRequest`, `ItemUpdateRequest`'e expiry alanları eklendi
- Web `item-list.tsx`: `ExpiryBadge` bileşeni — süresi dolmuş (🔴) / yaklaşan (🟡) Tooltip ile
- Web `item-form-modal.tsx`: "Süre & Rotasyon" bölümü — tarih input + gün input; create+edit modda
- Web `item-detail.tsx`: expiry/rotation bilgi kutusu, "Rotasyonu Kaydet" butonu (write izni olan item'larda)
- Web `items.ts`: `useRecordRotationMutation` hook

### 2026-05-16 (Win) — Kapsamlı Plan: PR-F1 ✅ + PR-N6 ✅ + PR-F2a ✅

Kapsamlı Geliştirme Planı (plan dosyasına göre) başlatıldı. Bu session'da tamamlananlar:

**PR-F1: Default admin + must_change_password** ✅
- Migration: `00021_must_change_password.sql` — `users.must_change_password BOOLEAN`
- Server: bootstrap admin seed, `must_change_password` login response, ChangePassword handler flag sıfırlar, CreateUser `must_change_password=true` set eder, BootstrapLogin response dahil
- Web: `mustChangePassword` auth store state, MustChangePasswordGate route guard, `/change-password` sayfası (Argon2id KEK yenileme + bootstrap keypair upgrade), login redirect filtresi (`/change-password` fromPath engeli), clear() reset fix

**PR-N6: Read event audit logging** ✅
- `item.viewed`, `item.listed`, `folder.listed` action sabitleri eklendi
- `WriteAsync()` metodu — goroutine + `context.Background()`, hot-path latency korunur
- GetItem, ListItems, ListFolders handler'larına async audit eklendi

**PR-F2a: TOTP Status/Disable/Backup + Admin Reset** ✅
- Server: `GET /api/v1/auth/totp/status`, `DELETE /api/v1/auth/totp`, `POST /api/v1/auth/totp/backup-codes/regenerate`, `POST /api/v1/admin/users/{id}/totp/reset`
- Audit constants: `auth.totp_disabled`, `auth.totp_backup_regenerated`, `admin.totp_reset`
- Web: `/profile` sayfası — TOTP durum kartı, devre dışı dialog (şifre onayı), backup regenerate dialog, UserCircle nav butonu AppShell'de
- Fix: `LoginRequest.totp_code` optional yapıldı; `ws.test.ts` no-arg WsClient constructor'a güncellendi

**PR-F4: Smart Item Type Fields** ✅
- Migration 00022: `item_types.field_groups JSONB`, `ssl_mode` enum field, server/database/ssh_key/url/cert/cloud type updates
- Server: `ListItemTypes` response includes `field_groups`
- Web: grouped field rendering under named section headers in ItemFormModal; flat fallback for legacy types

**PR-F6a: Groups + folder_group_permissions** ✅
- Migration 00023: `groups`, `group_members`, `folder_group_permissions` tables
- Server: `GroupHandlers` — CRUD + member management + folder-permission grant/revoke (9 routes)
- Audit: group.created/deleted/member_added/member_removed constants
- Web: `/admin/groups` page (list, create dialog, member management, delete), nav item, API hooks

**PR-F6b: Group-based folder visibility** ✅
- `ResolveFolderPermission` CTE extended with UNION-based perms CTE
- Adds group ACL path: `folder_group_permissions` JOIN `group_members` → same bool_or aggregation
- All server tests pass

**Sıradaki:** PR-N1 (Credential Expiry/TTL) veya PR-N2 (Secret Versioning)

### 2026-04-28 (Win) — Faz 5 kapandı: PR-A1/A2/P1/V1 merged — v1.0.0 🎉

**Tüm açık PR'lar merge edildi. Proje MVP tamamlandı.**

**PR-A2 conflict çözümü:**
`feat/item-attachments` branch'ında `client/src/components/inventory/item-detail.tsx` conflict vardı. PR-A1 description bölümü, PR-A2 branch'ı PR-A1 öncesi oluşturulduğu için eksikti. `git rebase origin/main` ile description bloğu korunarak çözüldü.

**PR-A1: Item description — merged (PR #15)**

| Dosya | Değişiklik |
|-------|-----------|
| `server/migrations/00018_item_description.sql` | `items.description TEXT` sütunu (nullable, goose up/down) |
| `server/internal/httpapi/item_handlers.go` | `itemResponse` + create/update request'e `description` alanı |
| `shared/pkg/src/api/types.ts` | `ItemResponse.description?: string` |
| `web/src/components/inventory/{item-detail,item-form-modal}.tsx` | Textarea gösterim + edit form |
| `client/src/components/inventory/{item-detail,item-form-modal}.tsx` | Tauri client (aynı) |
| `web/src/test/setup.ts` | jsdom 25 + vitest 2 worker localStorage shim fix |

**PR-A2: Item attachments — merged (PR #16)**

| Dosya | Değişiklik |
|-------|-----------|
| `server/migrations/00019_item_attachments.sql` | `item_attachments` tablosu |
| `server/internal/httpapi/item_attachment_handlers.go` | `POST .../attachments` (presigned PUT) + confirm + liste + presigned GET + DELETE |
| `deploy/k8s/configmap.yaml` | `ENVANTER_MINIO_ENDPOINT` + `ENVANTER_MINIO_BUCKET` |
| `deploy/k8s/secret.yaml.example` | `ENVANTER_MINIO_ACCESS_KEY` + `ENVANTER_MINIO_SECRET_KEY` |
| `server/internal/config/config.go` + `server/cmd/api/main.go` | MinIO config wire |
| `web/src/` + `client/src/` | `ItemAttachmentPanel` — upload/download/delete UI |

**PR-P1: Tauri packaging + macOS DMG CI — merged (PR #17)**

| Dosya | Değişiklik |
|-------|-----------|
| `client/src-tauri/tauri.conf.json` | Auto-updater endpoint + signature config |
| `client/src-tauri/capabilities/default.json` | `core:default` + updater capabilities |
| `client/src-tauri/Cargo.toml` + `src/lib.rs` | `tauri-plugin-updater = "2"` register |
| `.github/workflows/ci.yml` | `client-tauri-macos` job (universal binary) + `github-release` job |

**PR-V1: v1.0.0 release — merged (PR #18)**

- `client/package.json`, `Cargo.toml`, `tauri.conf.json`, `shared/pkg/package.json`, `web/package.json` → tümü `1.0.0`

---

### 2026-04-28 (Win) — Faz 5 başladı: PR-K1 k8s hardening

**Branch:** `feat/k8s-hardening` — devam ediyor.

**Faz 4 kapandı:** PR-C1 (Rust keyring+tray) merged ✅, PR-C6 (Win packaging, PR#7) CI bekliyor.

**PR-K1 kapsamı (k8s hardening batch-1):**

| Dosya | Değişiklik |
|-------|-----------|
| `deploy/k8s/namespace.yaml` | Pod Security Standards warn label eklendi (`restricted`) |
| `deploy/k8s/api.yaml` | GHCR ref düzeltildi (`bhaslaman` → `gameofai`), resource limits, securityContext (runAsNonRoot, drop ALL), readyzProbe düzeltildi, PodDisruptionBudget eklendi |
| `deploy/k8s/web.yaml` | GHCR ref düzeltildi, resource limits, securityContext, liveness+readiness probe eklendi |
| `deploy/k8s/postgres.yaml` | Resource limits, securityContext (fsGroup 999, runAsUser 999) |
| `deploy/k8s/argocd-app.yaml` | Repo URL güncellendi (`bhaslaman/Envanter_App` → `GameOfAI/IronStock`) |
| `deploy/k8s/kustomization.yaml` | YENİ: Kustomize config, `images:` section ile image tag yönetimi |
| `.github/workflows/ci.yml` | docker job: `permissions.contents: write` + "Update k8s image tags" adımı (kustomize edit + git commit + push [skip ci]) |

**Sıradaki:** PR-K2 (Sealed Secrets adoption) → PR-K3 (Ingress + TLS + NetworkPolicy) → PR-K4 (Prometheus metrics)

### 2026-04-28 (Win) — Faz 4 PR-C6: Windows binary + packaging + CI

**Branch:** `feat/client-win-packaging` — PR #7 açıldı, CI çalışıyor.

- `client/src-tauri/icons/`: 32x32, 128x128, 128x128@2x, icon.png (512), icon.ico oluşturuldu
- `tauri.conf.json`: productName=IronStock, icon paths, NSIS currentUser config
- `client/package.json`: `tauri:build:win` script eklendi
- `.github/workflows/ci.yml`: `client-tauri-win` job (windows-latest + Rust MSVC + swatinem cache + artifact upload)
- Code signing: Faz 5'e ertelendi

### 2026-04-28 (Win) — Faz 4 PR-C1: Rust keyring + inaktiflik timer + system tray

**Branch:** `feat/client-rust-foundation` — implement ediliyor.

**Mac PR'ları sync:** PR-C2/C3/C4/C5 + PR-13 tümü 2026-04-27 merged. Repo GameOfAI/IronStock'a taşındı. Bu session'da Windows üzerinden devam edildi.

**PR-C1 kapsamı:**

- `Cargo.toml`: `keyring = "2"` + `tokio = { version = "1", features = ["time"] }` + `tauri tray-icon` feature
- `src-tauri/src/commands.rs`: `kek_store` / `kek_load` / `kek_delete` (Windows Credential Manager / macOS Keychain) + `activity_ping` + `set_inactivity_timeout`
- `src-tauri/src/inactivity.rs`: `InactivityState` (last_activity + timeout_secs Mutex) + `start()` background thread (30s poll, `inactivity_lock` event emit)
- `src-tauri/src/tray.rs`: `TrayIconBuilder` — Göster / Kilitle / Çıkış menüsü; Kilitle → `inactivity_lock` event
- `src-tauri/src/lib.rs`: modüller wire + `manage(InactivityState)` + `invoke_handler`
- `src-tauri/capabilities/default.json`: Tauri 2 `core:default` capabilities
- `client/src/lib/tauri.ts`: `isTauri()` guard + typed wrapper'lar (kekStore/Load/Delete, activityPing, listenInactivityLock)
- `client/src/hooks/use-inactivity-lock.ts`: Tauri event path + browser fallback (setTimeout)
- `client/src/pages/login.tsx`: `kekStore` after `setSession`
- `client/src/components/layout/app-shell.tsx`: `handleLock` + `handleLogout` → `kekDelete` before clear

**Tasarım kararı — lock semantiği:** Lock = `kek_delete` (keyring'den sil) + `clear()`. Tam re-login gerekir. Quick-unlock (keyring'den KEK yükle) PR-C1 sonrası ayrı PR.

### 2026-04-27 (Win) — Faz 4 PR-C2: Client foundation — Tailwind 4 + shadcn/ui + TanStack Query + Zustand + ConnectionGate + CI

**Branch:** `feat/client-foundation` — push edildi, CI bekliyor.

**Faz 4'ün ikinci PR'ı.** Tauri client'a web admin UI ile tutarlı bir foundation kuruldu.

**Web'den farklı tasarım kararları:**

1. **ConnectionGate (yeni):** Desktop client farklı sunuculara bağlanabilir. `serverUrl` boşsa `/config` ekranına yönlendirir. Sıra: `/config` → `ConnectionGate` → `AuthGate` → `AppShell`.
2. **`api/client.ts` — configurable base URL:** Web'de path'ler `/api/v1/...` (proxy), client'ta `${baseUrl}/api/v1/...`. `setBaseUrl()` / `getBaseUrl()` module-level fonksiyonlar. Connection store hydration'da ve `setConnection()` çağrısında sync edilir.
3. **`store/connection.ts` (yeni):** `serverUrl + tlsSkipVerify` localStorage'da persist. `onRehydrateStorage` hook'u ile sayfa yenilemesinde `api/client` baseUrl'i güncellenir.
4. **`AppShell` — admin nav yok:** Faz 4 MVP'de inventory-only. Lock butonu var (PR-C1'de Rust keyring entegre edilince aktif olur, şimdilik logout gibi davranır). WsStatusDot yok (PR-C4'te eklenir).
5. **`vitest.config.ts` ayrı:** PR-S1'de öğrenilen ders — `@tailwindcss/vite` lightningcss platform binary sorununu önlemek için test config'i ayrı tutuldu.
6. **`index.css` Tauri ek:** `user-select: none` body'de (desktop app hissi), `input/textarea`'da `user-select: text` override.

**Oluşturulan dosyalar:**
- `client/package.json` — deps: Radix UI (dialog/label/slot/toast), TanStack Query, Zustand, lucide-react, react-router-dom, CVA, clsx, tailwind-merge. devDeps: Tailwind 4, testing-library, jsdom.
- `client/vite.config.ts` — Tailwind 4 plugin + `@/` alias (Tauri opts korundu).
- `client/vitest.config.ts` — ayrı config, tailwindcss plugin yok.
- `client/tsconfig.json` — `baseUrl + paths: @/* → ./src/*` eklendi.
- `client/src/index.css` — Tailwind 4 + shadcn token seti.
- `client/src/lib/cn.ts` — clsx + tailwind-merge.
- `client/src/api/{errors,types,token-storage,query,client}.ts`
- `client/src/store/{auth,ui,connection}.ts`
- `client/src/components/ui/{button,input,label,skeleton,card,toast,toaster}.tsx`
- `client/src/components/layout/{theme-provider,app-shell}.tsx`
- `client/src/hooks/use-toast.ts`
- `client/src/routes/{auth-gate,connection-gate}.tsx`
- `client/src/pages/{config,login,inventory,not-found}.tsx`
- `client/src/App.tsx` + `client/src/main.tsx` (tam yeniden yazım)
- `client/src/test/setup.ts`
- Test dosyaları: `lib/cn.test.ts`, `api/token-storage.test.ts`, `api/client.test.ts`, `store/auth.test.ts`, `store/connection.test.ts` — **21 test case**
- `.github/workflows/ci.yml` — `client` job (tsc + lint + test + vite build, Tauri binary derlenmez)

**Bilinçli kapsam dışı:**
- Login formu + KEK derive → PR-C3
- Folder/item UI → PR-C4
- E2E decrypt → PR-C5
- Rust keyring + tray → PR-C1
- Tauri binary CI → PR-C6

### 2026-04-27 (Mac) — Faz 4 PR-S1: @envanter/shared workspace — ortak tipler + kripto

**Branch:** `feat/shared-workspace` → PR #23 — CI ✅ merged.

**Faz 4'ün ilk PR'ı.** Hem `web/` hem `client/` tarafından kullanılacak ortak paket oluşturuldu.

**Yapılanlar:**

- Root `package.json` (npm workspaces: shared/pkg, web, client) eklendi
- `shared/pkg/` → `@envanter/shared` paketi oluşturuldu (private, ESM, exports map)
  - `./crypto` → `src/crypto.ts` (Argon2id KEK, AES-GCM wrap/unwrap, X25519 sealed-box, encryptField/decryptField)
  - `./api/types` → `src/api/types.ts` (tüm server DTO interface'leri)
  - `./api/errors` → `src/api/errors.ts` (ApiError class + ErrCode + helpers)
- `web/src/{lib/crypto,api/types,api/errors}.ts` → tek satır re-export stub'ları (mevcut import değişmedi)
- `client/package.json` + `web/package.json` → `"@envanter/shared": "*"` eklendi
- CI fix: web Install adımı root'tan çalışacak şekilde güncellendi
- `vitest.config.ts` ayrı oluşturuldu — tailwindcss plugin dışarıda (lightningcss Linux binary sorunu çözüldü)
- Root `package-lock.json` `.gitignore`'a eklendi (Mac lockfile'ı Linux binary'si içermiyordu)

**Sonuç:** `tsc -b` sıfır hata, 128/134 test pass (6 pre-existing localStorage mock sorunu, PR-S1 ile ilgisiz).

---

### 2026-04-27 (Mac) — Faz 3 PR-W6: Realtime + polish — WebSocket client + dark mode + responsive

**Branch:** `feat/web-realtime-polish` — push edildi, CI bekliyor.

**Faz 3'ün son PR'ı.** WebSocket client (exponential backoff reconnect), WsProvider, AppShell responsive (hamburger mobile + icon-only collapsed sidebar), dark mode toggle (zaten vardı, toggle button + persistence). Server'a query-param WS auth fallback eklendi (browser header seti yapamıyor).

**Server eklenti (`ws_handler.go`):**

Browser WebSocket API custom header gönderemiyor. `?access_token=TOKEN` query-param fallback eklendi (3 satır, `Authorization: Bearer` öncelikli, backward-compat).

**Web WS client (`src/api/ws.ts`):**

```
WsClient(accessToken)
  → new WebSocket('/api/v1/ws?access_token=TOKEN', ['envanter.v1'])
  → onopen → status: connected
  → onmessage → handleEvent(ev) → queryClient.invalidateQueries(...)
  → onclose → scheduleReconnect(exponential backoff, 1s→30s cap)
  → destroy() → cleanup
```

Event → cache invalidation mapping:
- `folder.*` → `queryKeys.folders.all` + `queryKeys.folders.detail(id)`
- `item.*` → `queryKeys.items.all` + `queryKeys.items.detail(id)`

**WsProvider (`src/components/ws-provider.tsx`):**

React Context ile `WsStatus` expose. `useAuthStore(s.accessToken)` değişince client create/destroy. `useWsStatus()` hook AppShell'de status dot için kullanılıyor.

**AppShell güncellemeleri:**

- WS status indicator: connected → gizli; reconnecting → spinner; offline → WifiOff icon
- Responsive sidebar: `md:` breakpoint'te 56px (icon-only) / 224px toggle; mobile'de fixed overlay + hamburger menu (`Menu` icon)
- `sidebarCollapsed` ui store'da zaten persist ediliyordu, sadece UI bağlandı
- A11y: `role="navigation"`, `aria-label` tüm icon button'lara, nav `NavLink`'lere `aria-label`

**Test (10 yeni test, 2 dosya):**

| Dosya | Test sayısı |
|-------|-------------|
| `src/api/ws.test.ts` | 7 (connect, status transitions, backoff, destroy, malformed JSON) |
| `src/components/ws-provider.test.tsx` | 3 (render, initial status, status update) |

Lokal: `tsc -b` ✅, `eslint --max-warnings 0` ✅, `vite build` ✅, 128/134 test (6 pre-existing Node22).

### 2026-04-27 (Mac) — Faz 3 PR-W5: Inventory write — folder/item CRUD + E2E encryption + share UI

**Branch:** `feat/web-inventory-write` — push edildi, CI bekliyor.

**Mac'in son Faz 3 PR'ı.** Folder/item oluştur/sil/yeniden adlandır; E2E alan şifreleme (client-side DEK gen + AES-GCM); paylaşım UI (amber banner — server DEK expose gerekiyor).

**Crypto primitives (`lib/crypto.ts` eklenti):**

| Fonksiyon | Açıklama |
|-----------|----------|
| `generateDEK()` | 32B rastgele AES-256 DEK |
| `sealDEK(dek, recipientPubKey)` | X25519 sealed-box: ephemeral keypair + ECDH + AES-GCM → 80B wrapped + 12B nonce |
| `openDEK(wrapped, nonce, privateKey)` | sealDEK tersi, privateKey PKCS#8'e dönüştürülüp WebCrypto'ya geçirilir |
| `encryptField(value, dek)` | AES-256-GCM field encrypt → value_enc (ciphertext+tag) + value_nonce (12B) |
| `decryptField(valueEnc, valueNonce, dek)` | AES-256-GCM field decrypt → string |

**Yeni API mutations:**

| Dosya | Hook | Endpoint |
|-------|------|----------|
| `folders.ts` | `useCreateFolderMutation`, `useUpdateFolderMutation(id)`, `useDeleteFolderMutation` | `POST/PUT/DELETE /api/v1/folders` |
| `items.ts` | `useCreateItemMutation(folderId)`, `useUpdateItemMutation(id, folderId)`, `useDeleteItemMutation(folderId)`, `useShareItemMutation(itemId)`, `useUnshareItemMutation(itemId)` | `POST/PUT/DELETE /api/v1/items`, `/items/:id/shares` |
| `catalog.ts` | `useUserPublicKey(userId)` | `GET /api/v1/users/:id/public-key` |

**Yeni componentler (`components/inventory/`):**

- `folder-form-modal.tsx` — Klasör oluştur / yeniden adlandır dialog (ortak modal, `editFolder` prop ile branch)
- `folder-delete-dialog.tsx` — AlertDialog + cascade sil uyarısı
- `item-form-modal.tsx` — Item oluştur (dynamic field input by item type, toggle password visibility, E2E encrypt on submit) / düzenle (sadece ad — alan decrypt için server DEK expose gerekiyor, amber banner)
- `item-delete-dialog.tsx` — AlertDialog + confirm
- `item-share-modal.tsx` — Kullanıcı picker + yetki seç + amber banner (server `owner_dek_wrapped` expose edilince aktif)

**Sayfa güncellemesi (`pages/inventory/index.tsx`):**

- Folder toolbar (sol panel header): Yeni Klasör + Yeniden Adlandır + Sil butonları
- Item toolbar (orta panel): Yeni Item butonu + seçili item için Düzenle/Paylaş/Sil
- Tüm modal state burada yönetiliyor: `folderModal: 'create'|'rename'|'delete'|null`, `itemModal: 'create'|'edit'|'delete'|'share'|null`

**E2E encryption (create flow):**

```
client generateDEK() → 32B
sealDEKWithKEK(dek, privateKey) → owner_dek_wrapped (80B) + owner_wrap_nonce (12B)
encryptField(value, dek) → value_enc + value_nonce
POST /api/v1/items { id: UUIDv4, fields: [{value_enc, value_nonce}], owner_dek_wrapped, owner_wrap_nonce }
```

Not: Server expose etmeden önce DEK, X25519 sealed-box yerine `SHA256(privateKey)` türetilmiş AES key ile wrap ediliyor (MVP simplification, server DEK expose edilince sealDEK fonksiyonuna geçiş). Server sadece opak blob depoluyor — şema uyumlu.

**Test (21 yeni test, 4 dosya):**

| Dosya | Test sayısı |
|-------|-------------|
| `lib/crypto.test.ts` (ek) | 9 (generateDEK, encryptField/decryptField roundtrip, sealDEK/openDEK roundtrip) |
| `components/inventory/folder-form-modal.test.tsx` | 5 |
| `components/inventory/item-form-modal.test.tsx` | 7 |
| `components/inventory/item-delete-dialog.test.tsx` | 3 |

Lokal: `tsc -b` ✅, `eslint --max-warnings 0` ✅, `vite build` ✅, 118/124 test geçiyor (kalan 6 pre-existing Node 22+ jsdom localStorage bug).

**Win'e iletilmesi gereken bilgi:** PR-W5 merge sonrası Win'in `item_handlers.go` dosyasında `itemResponse`'a `owner_dek_wrapped` + `wrap_nonce` eklenmesi halinde alan decrypt + gerçek X25519 sharing aktif olacak.

### 2026-04-27 (Mac) — Faz 3 PR-W4: Inventory read — folder tree + item list + detail panel

**Branch:** `feat/web-inventory-read` — push edildi, CI yeşili bekleniyor.

**KeePassXC tarzı 3-panel envanter view'u.** PR-W3'ten sonra Mac'in 2. PR'ı, ekran-spesifik token-verimli pattern (foundation tamamen Win'den hazır geldi).

**Yeni hooks (`src/api/`):**

| Dosya | Hook(lar) | Endpoint |
|-------|-----------|----------|
| `folders.ts` | `useRootFolders`, `useChildFolders(id, enabled)`, `useFolder(id)` | `GET /folders[?parent_id=]`, `/folders/:id` |
| `items.ts` | `useItems(folderId, q?)`, `useItem(id)` | `GET /items?folder_id=&q=`, `/items/:id` |
| `catalog.ts` | `useFieldDefinitions`, `useItemTypes` | `GET /field-definitions`, `/item-types` (`staleTime: Infinity` — semi-static lookup) |

**Sayfa:**

`/inventory` (`pages/inventory/index.tsx` ~110 LOC) — 3-panel grid:
- Sol: FolderTree (260px sabit)
- Orta: Search (debounced 300ms) + ItemList (esneme)
- Sağ: ItemDetail (max 420px)
- URL state: `?folder=<id>&item=<id>&q=<text>` — bookmark + back button (PR-W3 ile tutarlı pattern, ADR-0009 §1)
- Folder seçince eski `item` sıfırlanır; search değişince eski `item` sıfırlanır (sonuç değişebilir)

**Yeni componentler (`components/inventory/`):**

- `folder-tree.tsx` — root folders + lazy-load child level (`useChildFolders(id, isExpanded)`)
- `folder-tree-node.tsx` — recursive node, chevron expand/collapse + Loader/Error/Empty inline state, depth-based indent (12px/level)
- `item-list.tsx` — Table + skeleton + empty (klasör seçilmemiş / boş / search no-match) + error states + click-to-select row highlight
- `item-search.tsx` — debounced Input + clear button. HMAC blind-index = exact match → "Tam item adı (ör. mysql-prod)" placeholder uyarısı
- `item-detail.tsx` — header (icon + name + type + permission badge + dates) + alt panel field listesi + amber bilgi kutusu ("Alan değerleri uçtan uca şifreli. PR-W5 düzenleme modunda görüntülenecek.")
- `item-field-row.tsx` — label + key + field_type meta + 🔒 "Şifreli" placeholder (decrypt PR-W5'te)
- `permission-badge.tsx` — read/write × full vs compact (W/R) modları, table cell için kompakt

**Önemli karar — decrypt deferred:**

`itemResponse` Go struct'ı `owner_dek_wrapped + wrap_nonce` döndürmüyor (server item_handlers.go). Yani client decrypt edemiyor. PR-W4 sadece metadata + field tanımı (catalog) gösterimi yapıyor. PR-W5'te Win'den şu istek: itemResponse'a wrapped DEK ekle (caller pub_key'ine wrap, leak yok). UI'da bu durum amber info kutusunda kullanıcıya açık.

**Test (34 yeni test, 7 dosya):**

| Dosya | Test sayısı |
|-------|-------------|
| `api/folders.test.ts` | 6 |
| `api/items.test.ts` | 5 |
| `components/inventory/folder-tree.test.tsx` | 4 |
| `components/inventory/item-list.test.tsx` | 6 |
| `components/inventory/item-detail.test.tsx` | 5 |
| `components/inventory/item-search.test.tsx` | 4 (fake timers + fireEvent) |
| `components/inventory/permission-badge.test.tsx` | 4 |

Lokal: `tsc -b` ✅, `eslint --max-warnings 0` ✅, `vite build` ✅, 97/103 test geçiyor (kalan 6 PR-W1 lokal Node 22+ jsdom localStorage bug'ı, CI Node 20'da geçiyor).

**Sıradaki:** PR-W4 review/merge → Mac PR-W5 (inventory write + decrypt). Ön gerekli: server itemResponse'a wrapped DEK alanı.

### 2026-04-27 (Mac) — Faz 3 PR-W3: Admin user mgmt + audit log viewer

**Branch:** `feat/web-admin` — push edildi, CI yeşili bekleniyor.

**Mac sırası açıldı.** Win'in PR-W2 (auth + KEK) merge'i sonrası foundation + auth context + KEK store hazırdı; bu PR onun üzerine admin sayfalarını koydu.

**Yeni hooks (`src/api/admin.ts` ~95 LOC):**

| Hook | Endpoint |
|------|----------|
| `useUsers({limit, offset})` | `GET /api/v1/admin/users` |
| `useGrantRoleMutation(userId)` | `POST /admin/users/:id/roles` |
| `useRevokeRoleMutation(userId)` | `DELETE /admin/users/:id/roles/:role_name` |
| `useDisableUserMutation(userId)` | `POST /admin/users/:id/disable` |
| `useEnableUserMutation(userId)` | `POST /admin/users/:id/enable` |
| `useAuditLog(filters)` | `GET /api/v1/admin/audit-log?...` |

Tüm mutation'lar `onSuccess`'te `queryClient.invalidateQueries({queryKey:['admin','users']})` çağırıyor; tablo otomatik tazeleniyor.

**Sayfalar:**

`/admin/users` (`pages/admin/users.tsx` ~95 LOC) — KeePassXC tarzı tablo:
- Kolonlar: Kullanıcı / Email / Status (renkli badge) / Roller (multi-badge group) / Son Giriş (relative time + tooltip) / [⋮] dropdown
- DropdownMenu içinde: 3 rol checkbox (admin / write / read) + Devre Dışı / Etkinleştir
- Self-protection: kendi admin rolü ve kendi disable disabled state + tooltip ("Kendi admin rolünüzü kaldıramazsınız")
- Disable destructive → AlertDialog confirm; role toggle idempotent → optimistic, hata olunca toast
- Pagination URL state: `?page=2&size=50` — bookmark + back button + paylaşılabilir URL

`/admin/audit-log` (`pages/admin/audit-log.tsx` ~150 LOC) — filtreli audit görüntüleyici:
- 5 filter (action / actor / resource_type / from / to) — URL search params'a tam sync
- Action sütunu: lucide icon + renk + monospace label (29 audit constant tabloda)
- Aktör sütunu: `useUsers` cache'inden client-side `userMap` lookup; null → "Sistem", map'te yoksa → "silinmiş kullanıcı" italic fallback (ADR-0009 §5)
- Resource sütunu: `type:UUID` — UUID 8 hane gösterimi + title attribute'ta tam UUID
- Detay sütunu: `[▶]` chevron toggle → inline Collapsible açılıyor (modal yok), pretty-print JSON (`details + ip_address + user_agent` birleştirilir)
- Birden fazla satır aynı anda açılabilir — audit araştırması pattern'i
- Filter değişince `page=1`'e dönüş

**Yeni componentler:**

`components/admin/`:
- `status-badge.tsx` — 4 status × renkli outline badge (active/pending_totp/disabled/locked)
- `role-badges.tsx` — admin (default mavi dolu) + write/read (outline), sıralı gösterim
- `action-icon.tsx` — 29 audit action × icon + color tablosu, `ALL_AUDIT_ACTIONS` filter dropdown export
- `user-table.tsx` — pure presentational table + skeleton + empty state
- `user-actions-menu.tsx` — DropdownMenu + 3 role checkbox + disable/enable + self-protection tooltips
- `disable-confirm-dialog.tsx` — AlertDialog (yıkıcı aksiyon onayı)
- `audit-filters.tsx` — 2 Select + 2 datetime-local + Clear button; lokal/UTC dönüşüm helper'ları (`localToISOZ` / `isoZToLocal`)
- `audit-row.tsx` — Collapsible inline detail expansion + actor lookup + resource truncation

`components/common/`:
- `pagination.tsx` — Prev/Next + sayfa boyutu Select (25/50/100) + total counter
- `relative-time.tsx` — "2dk önce" + Tooltip ile tam tarih (Türkçe locale)

**shadcn primitives eklendi:** badge, dropdown-menu, checkbox, collapsible, popover, tooltip, alert-dialog (`npx shadcn@latest add ...`).

**Test (29 yeni test, 7 dosya):**

| Dosya | Test sayısı | Kapsam |
|-------|-------------|--------|
| `api/admin.test.ts` | 7 | hook'ların apiFetch'i doğru çağırması + mutation invalidation |
| `components/admin/audit-row.test.tsx` | 6 | userMap lookup, "Sistem" / "silinmiş kullanıcı" fallback, JSON expand, UUID truncation |
| `components/admin/audit-filters.test.tsx` | 4 | Clear button conditional, datetime mapping |
| `components/admin/user-table.test.tsx` | 4 | render/empty/skeleton/last-login fallback |
| `components/admin/role-badges.test.tsx` | 3 | empty/render/order |
| `components/admin/status-badge.test.tsx` | 1 | 4 status label |
| `components/common/pagination.test.tsx` | 4 | render/disable/click |

Lokal: `tsc -b` ✅, `eslint --max-warnings 0` ✅, `vite build` ✅, 62/68 test geçiyor (kalan 6 PR-W1'in lokal Node 22+ jsdom localStorage bug'ı; Node 20 CI'da geçiyor).

**Sıradaki:** PR-W3 review/merge → Mac PR-W4 (inventory read: folder tree + item list + detail panel).

### 2026-04-27 (Win) — Faz 3 PR-W2: Web auth — login + TOTP setup + recovery + change-password + KEK akışı

**Branch:** `feat/web-auth` — review/merge bekliyor.

**Web client'ın auth boyutu tamamen çalışır halde.** Login → KEK türetme → priv key decrypt → in-memory session zincirinin tüm parçaları yerli yerinde.

**Kripto altyapısı (`src/lib/crypto.ts`):**

| API | Kullanım |
|-----|----------|
| `deriveKEK(password, salt, params)` | hash-wasm Argon2id WASM, 32B key, ~200-500ms |
| `encryptPrivateKey(plaintext, kek)` | WebCrypto AES-256-GCM + versioned blob `[ver][alg][nonce][ct+tag]` (server format mirror) |
| `decryptPrivateKey(blob, kek)` | Inverse — version + alg byte validation + tamper check |
| `generateX25519Keypair()` | WebCrypto X25519 (Chrome 113+ / FF 130+ / Safari 17+); recover-complete için |
| `randomKEKSalt()` | 16B crypto.getRandomValues |
| `fromBase64` / `toBase64` | RFC 4648 (atob/btoa) |

**Karar değişikliği — ADR-0009 implementation note:** ADR `argon2-browser` öneriyordu ama Vite v5 ile WASM yükleme zorlukları (eski paket, son güncelleme 2 yıl önce). **`hash-wasm@4.11`** kullanıldı — modern API, Vite-uyumlu, aynı Argon2id RFC 9106. ADR-0009 §3 spirit'i korunuyor (WASM Argon2id), implementasyon detayı.

**API hooks (`src/api/auth.ts` + `me.ts`):**

| Hook | Endpoint |
|------|----------|
| `useLoginMutation` | POST `/auth/login` (single-step pwd + TOTP) |
| `useLogoutMutation` | POST `/auth/logout` |
| `useLogoutAllMutation` | POST `/auth/logout-all` |
| `useChangePasswordMutation` | POST `/auth/change-password` |
| `useTOTPInitMutation(tmpToken)` | POST `/auth/totp/init` (raw fetch — tmp_token Authorization, access store kirletme) |
| `useTOTPVerifyMutation` | POST `/auth/totp/verify` |
| `useRecoverInitMutation` | POST `/auth/recover/init` |
| `useRecoverCompleteMutation` | POST `/auth/recover/complete` |
| `fetchMyKeypair(token)` (raw) | GET `/users/me/keypair` — login flow chain (token henüz store'a girmedi) |
| `useMyKeypairMutation` | Mutation wrapper (post-login) |

**Pages:**

`pages/login.tsx` — Form `{username, master_password, totp_code}`. Substep state machine:
1. `authenticating` → POST /auth/login
2. `fetching_keypair` → GET /users/me/keypair (fresh access token, not yet in store)
3. `deriving_key` → Argon2id (heavy, spinner label "Anahtar türetiliyor...")
4. `unlocking` → AES-GCM decrypt → priv key
5. `setSession({ user, accessToken, refreshToken, kek, privateKey })`
6. `navigate(from || '/inventory')`

`pages/totp-setup.tsx` — 3 phase: enroll (auto-init → otpauth_uri + secret_base32) / verify (TOTP code) / recovery_codes (10 plaintext, "ONCE" warning + manual save confirm). QR rendering Faz 3 polish'inde (kütüphane). Şimdilik base32 secret + URI manuel kopyalanır.

`pages/recover.tsx` — 4 phase:
1. `init` → username + recovery_code → tmp_token
2. `warn` → ⚠ kritik UX warning: "eski item_shares wrap'lı erişim KAYBEDİLECEK" (ADR-0004 §9 client-side enforcement)
3. `complete` → yeni X25519 keypair + KEK + priv encrypt → /recover/complete
4. `codes` → 10 yeni recovery code (eskiler invalid)

`components/change-password-dialog.tsx` — Settings'ten erişilen modal:
- Mevcut + yeni + onay
- **public_key SABIT** (item_shares korunur — ADR-0004 §9, change-password için)
- Yeni KEK + mevcut RAM'deki priv'i yeniden wrap → submit
- Server tüm session'ları revoke → `clear()` + navigate `/login`

**AppShell güncellemesi:**
- Logout butonu → `useLogoutMutation` (server'a POST + best-effort, fail olsa bile local clear)
- Yeni KeyRound icon → ChangePasswordDialog tetikleyici
- ChangePasswordDialog AppShell altında mount

**Routes (App.tsx):**
- `/login` (public)
- `/totp/setup` (public, tmp_token route state ile gelir)
- `/recover` (public, multi-phase wizard tek route)
- Geri kalan değişmedi (AuthGate + AppShell + RoleGate admin)

**Hidratasyon:** `HydrateBoot` hâlâ `setHydrating(false)` yapıyor — silent-refresh denemesi ileri PR'a (gerçek refresh token ile boot-time auth restore). PR-W2 kapsamı: kullanıcı manuel login yapar.

**Tests (~9 yeni case):**

`src/lib/crypto.test.ts`:
- base64 roundtrip + RFC4648 known vector (3)
- randomKEKSalt 16B + uniqueness (1)
- AES-GCM encrypt/decrypt roundtrip + length check (1)
- AES-GCM wrong KEK fail (1)
- Truncated blob rejection (1)
- Bad version byte (1)
- Bad algorithm byte (1)

WebCrypto kullanımı (jsdom 25 + Node 20 globalThis.crypto.subtle).

**Lokal validation atlandı:** Win'de Node yok, CI'a güveniyoruz. PR-W1'in CI fix patterns'i hazır olduğu için type-check + lint + test + build aynı job'da yeniden çalışacak.

**Mac için yeşil ışık:** PR-W2 merge sonrası **Mac PR-W3 başlayabilir** (admin user mgmt ekranı). Bağımlılıkları:
- ✓ PR-10 (server admin endpoints) main'de
- ✓ PR-11 (server audit log + catalog) main'de
- ✓ PR-12 (server /me/keypair) main'de
- ✓ PR-W1 (web foundation) main'de
- → PR-W2 (auth) merge sonrası Mac unlock olur

**Sıradaki:** PR-W2 merge → Mac PR-W3 → PR-W4 → PR-W5. Bu sırada Win bekleme moduna geçer (PR-W6 realtime+polish için Mac PR-W5 sonrası).

### 2026-04-27 (Win) — Faz 3 PR-W1: Web foundation (Vite + Tailwind 4 + shadcn/ui + TanStack Query + Zustand + API client SDK + routing + Vitest)

**Branch:** `feat/web-foundation` — review/merge bekliyor.

**Faz 3 web tarafının iskeleti.** Mac PR-W3+ (admin/inventory) için tüm temel alt yapı hazır. ADR-0009 kararları aynen uygulandı.

**Toolchain (package.json):**
- `react@18.3` + `react-router-dom@6.27`
- `@tanstack/react-query@5.59` + devtools
- `zustand@5` (devtools + persist middleware)
- `tailwindcss@4` + `@tailwindcss/vite` (CSS-first, @theme + CSS vars)
- shadcn/ui copy-paste primitives (Button/Input/Label/Card/Toast/Toaster/Dialog/Table/Select/Skeleton)
- `@radix-ui/react-{dialog,label,select,slot,toast}` + `lucide-react`
- `class-variance-authority` + `clsx` + `tailwind-merge` (`cn` helper)
- `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`

**Tailwind 4 setup:**
- `src/index.css`: `@import 'tailwindcss'` + light/dark CSS vars (HSL) + `@theme` mapping → utility class'lar (`bg-background`, `text-muted-foreground`, etc.) shadcn convention'ında
- `vite.config.ts`: `tailwindcss()` plugin + `'@'` alias (`/src`)

**API client SDK (`src/api/`):**

| Dosya | Sorumluluk |
|-------|-----------|
| `client.ts` | `apiFetch<T>(path, options)` — Bearer ekler, 401 invalid_token'da tek seferlik `/auth/refresh` + retry, refresh fail → `clearAllTokens` + `auth:logout` event. JSON in/out, 204 → undefined, network err → `ApiError(status=0)`. `inflightRefresh` ile concurrent refresh collapse. |
| `errors.ts` | `ApiError` (status + code + message + details), `ErrCode` constants (server `error.go` mirror), `isAccessTokenExpired` / `isUnrecoverableAuth` helpers |
| `token-storage.ts` | accessToken **memory-only** module-level var; refreshToken localStorage `envanter.refresh_token`. KEK + privKey burada YOK — auth store'da. |
| `query.ts` | `QueryClient` (staleTime 30s, gcTime 5dk, ApiError'da retry yok) + `queryKeys` factory (folders/items/admin/catalog) — WS event invalidation için stable keys |
| `types.ts` | Manuel TS DTO'ları (Faz 3 polish PR'ında `schema.gen.ts`'e taşınacak). `[]byte` server alanları → `string` (base64) |

**Stores (`src/store/`):**

| Store | İçerik |
|-------|--------|
| `auth.ts` (Zustand + devtools) | `user`, `accessToken`, `kek`, `privateKey`, `hydrating` + `setSession` / `setAccessToken` (rotation) / `clear` (Uint8Array.fill(0) ile zeroize) + `selectIsAuthenticated/IsAdmin/HasRole(role)` selektörleri. **kek + privateKey memory-only**, persist YOK. |
| `ui.ts` (Zustand + persist) | `theme: 'light'|'dark'|'system'`, `sidebarCollapsed`. localStorage `envanter-ui` key altında persist. |

**Layout (`src/components/layout/`):**

- `theme-provider.tsx` — `theme` 'system' ise `prefers-color-scheme` MediaQueryList ile dinamik resolve; `<html>`'a `dark` class toggle.
- `app-shell.tsx` — TopBar (logo + username + theme toggle + logout) + Sidebar (Envanter / Kullanıcılar+Audit Log admin'e visible) + `<Outlet />`.

**Routing (`src/routes/auth-gate.tsx` + `App.tsx`):**

- `AuthGate` — `hydrating` ise `<Splash />` (Skeleton'lı loading), authed değilse `<Navigate to="/login" state={{from}}/>`.
- `RoleGate` — admin gerekirse role intersection check, başarısız → `/inventory`'e fallback.
- `App.tsx` route ağacı: `/login` (public), `<AuthGate>` altında `<AppShell>` → `/inventory/*` (any authed) + `<RoleGate role=admin>` altında `/admin/users` + `/admin/audit-log`. 404 → NotFoundPage.
- `AuthEventBridge` component'i `auth:logout` custom event'ini dinler → `clear()` + `navigate('/login')` (refresh failure flow).
- `HydrateBoot` — şimdilik `setHydrating(false)` only; PR-W2'de silent refresh denemesi olacak.

**Pages (`src/pages/`):**

| Page | Doldurulacağı PR |
|------|-----------------|
| `login.tsx` | PR-W2 (Win) — Argon2id KEK + keypair fetch + setSession |
| `inventory/index.tsx` | PR-W4 (Mac) — folder tree + item list + detail panel |
| `admin/index.tsx` (`AdminUsersPage` + `AdminAuditLogPage`) | PR-W3 (Mac) — user mgmt + audit log viewer |
| `not-found.tsx` | foundation tamam (404) |

Şimdilik placeholder Card'lar + "PR-WX'te dolacak" notu — Mac sahası açık bırakıldı (`web/src/pages/admin|inventory/**`).

**Tests (`src/**/*.test.ts`):**

- `lib/cn.test.ts` — clsx + tailwind-merge sanity (4 case: plain merge, falsy drop, conflict resolve, nested objects/arrays)
- `api/token-storage.test.ts` — access memory-only roundtrip, refresh localStorage persist, clearAll wipe (4 case)
- `api/errors.test.ts` — ApiError constructor + isAccessTokenExpired (5 case) + isUnrecoverableAuth (3 case)
- `api/client.test.ts` — Bearer attach, unauthenticated:true skip, JSON parse, 204 undefined, ApiError code, **refresh + retry happy path**, **refresh failure → auth:logout event**, query string drop undefined, network error wrap (9 case)
- `store/auth.test.ts` — initial state, setSession, selectIsAdmin, clear() with Uint8Array zeroize, setAccessToken rotation (5 case)
- `test/setup.ts` — `cleanup()` + auth store reset between tests

Toplam ~27 yeni test case. Vitest `jsdom` env, `globals: true`, setup auto-discover.

**CI yeni job (`.github/workflows/ci.yml`):**
- `web` job: Node 20 + `npm install` (lock dosyası ileride eklenecek) + `tsc -b --noEmit` type-check + `npm run lint` + `npm test` + `npm run build`. Server job'undan bağımsız fail.
- `npm ci` yerine `npm install` — package-lock.json bu PR'da yok (Win'de Node kurulu değil); Mac veya CI ilk run'da generate edecek, sonraki PR'da commit'lenir.

**Lokal validation atlandı:** Win'de Node.js kurulu değil. Foundation tamamen CI'a doğrulanacak (yeni `web` job). Win sadece server (Go) tarafında lint/test/build çalıştırıyor — bu kasıtlı bölüm zaten; Mac tarafında web doğrulaması yapılır. Mac PR-W3 başlamadan CI yeşilliği geldikten sonra emin oluyoruz.

**Mac sahası ayrımı:**
- `web/src/pages/admin/**` ve `web/src/pages/inventory/**` Mac'in alanı — sadece placeholder dosyalar bıraktım, içeriği dolduracak
- `web/src/{api,store,components,lib,hooks,routes,test}/**` Win sahası — PR-W2 + PR-W6'da Win burada çalışacak
- `web/src/App.tsx` ve `pages/login.tsx` Win sahası

**Sıradaki:** PR-W2 — Auth screens (login + TOTP setup + recovery + change-password). argon2-browser entegrasyonu, KEK türetme, `setSession`. PR-W1 merge sonrası başlıyorum.

### 2026-04-27 (Win) — Faz 3 PR-12: /users/me/keypair endpoint (KEK derive için)

**Branch:** `feat/server-me-keypair` — review/merge bekliyor.

**Mac sorularından doğan ufak server PR'ı.** Mac (PR-W2 auth flow) `useAuth()` context'inde `kek + privateKey` expose ederken bu blob'ları çekecek. Login response'a embed etmek yerine ayrı endpoint:

**Karar gerekçesi (Q4):**
- `/auth/login` zaten karmaşık (TOTP + lockout + session create + roles fetch). Payload şişmemeli.
- Login → tek round-trip access+refresh, ardından `GET /users/me/keypair` ile keypair fetch — temiz separation.
- Faz 4 Tauri'de unlock akışı benzer pattern (lock olduğunda priv RAM'den silinir, unlock'ta yeniden çekilir).

**Yeni endpoint:**

`GET /api/v1/users/me/keypair` (Bearer access)
- Caller'ın `claims.Subject` ile `user_keypairs` row'unu döndürür
- Yanıt:
  ```json
  {
    "public_key": "<32B base64>",
    "private_key_enc": "<bytes base64>",
    "kek_salt": "<bytes base64>",
    "kek_params": {"t":3,"m":65536,"p":4,"v":1,"salt_b64":"..."},
    "version": 1,
    "rotated_at": "2026-04-27T10:00:00Z"
  }
  ```
- 404 if no row (register sonrası INSERT same-tx; pratikte unreachable, defensive guard)
- `rotated_at` omitempty — yeni hesap için JSON'da görünmez

**Routing collision kontrolü:**
- `/users/me/keypair` (literal "me") → bu endpoint
- `/users/{id}/public-key` (UUID id) → existing endpoint
- chi routing specific-before-generic, çakışma yok (test ile pin'lendi)

**Implementation:**
- `CatalogHandlers`'a `GetMyKeypair` metodu eklendi (lookup table semantik orada toplanmıştı)
- Yeni handler struct YOK — tek metod ekleme
- SQL: `SELECT public_key, private_key_enc, kek_salt, kek_params::text, version, rotated_at::text FROM user_keypairs WHERE user_id = $1::uuid`
- `kek_params::text` cast → `json.RawMessage` (client'a opaque)

**Tests (5 yeni, toplam 196 PASS):**
- `myKeypairResponse` JSON wire format pin (7 field assertion)
- `rotated_at` nil → omitempty doğrulaması
- chi routing specific-before-generic (`/users/me/keypair` vs `/users/{id}/public-key`)
- `GetMyKeypair` no-claims early-return
- `CtxKeyClaims` drift koruması + `ClaimsFromContext` roundtrip

**Mac (Pro) sorularına yanıtlar (özet):**
- **Q1 client.ts pattern:** TanStack Query + custom typed fetch wrapper (RTK Query DEĞİL). Refresh rotation interceptor `client.ts` içinde.
- **Q2 UI lib:** Tailwind 4 + shadcn/ui copy-paste. PR-W1'de Button/Input/Card/Dialog/Toast/Table/Select pre-install.
- **Q3 state:** Zustand (UI/auth ephemeral) + TanStack Query (server state). Hibrit.
- **Q4 KEK türetme:** argon2-browser, `useAuth()` context'inde `kek + privateKey` memory-only. Bu PR (PR-12) backend'i hazırlıyor.
- **Q5 audit username:** Frontend mapping (Mac'in (a) önerisi). `/admin/users` zaten cache'lenecek, deleted user için "deleted_user" fallback UI tarafında.
- **Bonus WS auth:** `Sec-WebSocket-Protocol` subprotocol abuse (`['bearer.<token>']`). PR-W6'da Win server-side parse helper ekleyecek; Mac PR-W3/W4'te realtime'sız fallback OK.

**ADR-0009 (state management):** Mac yazıyor (CLAUDE.md "Mac aktif" + ADR iskelet). Win bu PR'da tracking güncellemesi yapmıyor (alan ayrımı).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 196 case PASS (önceki 191 + 5 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues (Win local'de `diff` aracı için Git'in usr/bin'i PATH'e eklendi — CI Linux'unda zaten var)

**Sıradaki:** PR-W1 — Web foundation. Vite proje setup + Tailwind + shadcn/ui pre-install + TanStack Query + Zustand store iskeleti + API client SDK + chi router + layout shell.

### 2026-04-27 (Mac) — ADR-0009 yazıldı: Web stack kararı + Mac aktif

**Branch:** `feat/web-state-mgmt-adr` — küçük doc PR'ı, Win'in akışını bloklamaz.

Mac yeniden devrede. Faz 3 web stack kararı Win + Mac arasında netleşti, ADR-0009 olarak kalıcılaştırıldı:

- **State:** Zustand (UI) + TanStack Query (server) hibrit — RTK Query reddedildi.
- **Styling:** Tailwind 4 + shadcn/ui (copy-paste, MIT) + lucide-react.
- **API:** Custom typed fetch wrapper + manuel TS tipleri (Faz 3 polish PR'ında schema.gen.ts).
- **Crypto:** argon2-browser (WASM) + WebCrypto AES-GCM + @noble/curves fallback (X25519).
- **KEK akışı:** Win PR-12 ekleyecek `GET /users/me/keypair`; login sonrası argon2id türetip authStore memory-only sakla.
- **WS auth:** `Sec-WebSocket-Protocol: bearer.<token>` subprotocol (PR-W6).

**CLAUDE.md güncellendi** — "İş Bölümü" Win-only paused durumdan Faz 3 aktif duruma geçti, sahalar netleştirildi (Mac: `web/src/pages/admin|inventory/**`, Win: server + foundation + layout + auth + realtime).

**Mac sırası:** PR-12 + PR-W1 + PR-W2 merge sonrası unlock — sırayla PR-W3 (admin), PR-W4 (inventory read), PR-W5 (inventory write).

### 2026-04-27 (Win) — Faz 3 PR-11: Audit log query + catalog read endpoints + OpenAPI minimal sync

**Branch:** `feat/server-readapi` — review/merge bekliyor.

**Server tarafı Faz 3 backend'i bu PR ile tamamlanıyor.** Web client'ın ihtiyacı olan tüm read endpoint'leri ve admin audit görüntüleme hazır.

**Yeni endpoint'ler:**

`GET /api/v1/admin/audit-log` (admin role)
- 6 filter parametresi (AND-combined): `action`, `actor_user_id`, `resource_type`, `resource_id`, `from`, `to` (RFC3339).
- Pagination: `limit` (default 50, max 500) + `offset`.
- Yanıt: `{entries[], total (filtered), limit, offset}` — total filtered count, frontend doğru pagination yapsın.
- `auditFilter.whereClause()` dinamik placeholder ($1, $2, ...) builder, count + page sorgularında ortak.
- Resource type CHECK constraint mirror'lanmış (drift erken yakalanır).
- ORDER BY id DESC (en yeni önce, BRIN index ile hızlı).

`GET /api/v1/field-definitions` (any authed)
- 30 seed field tanımının full liste (pagination yok — ~100 sınırı altında, client cache'ler).
- Yanıt: `{field_definitions[]}` — id, key, label, field_type, is_secret, hint?, validation_regex?, allowed_values? (enum field'ları için).
- Item edit formu için kritik (web Mac PR-W5).

`GET /api/v1/item-types` (any authed)
- 8 seed tip listesi: server, url, database, ssh_key, certificate, cloud_credential, note, generic.
- Yanıt: `{item_types[]}` — id, key, label, icon?, suggested_fields, default_launchers (Faz 4 client tarafı).

`GET /api/v1/users/{id}/public-key` (any authed)
- Item paylaşım modal'ı için kritik: client recipient pub_key'i alır → X25519 wrap → `/items/:id/shares` POST.
- 404 if user not found OR `status='disabled'` (paylaşım hedefi olamaz).
- Yanıt: `{user_id, username, public_key (32B X25519, base64 in JSON)}`.

**Yeni paket parçaları:**
- `internal/httpapi/admin_audit.go` (AdminHandlers'a yeni metod): `QueryAuditLog`, `auditFilter` builder
- `internal/httpapi/catalog_handlers.go` (yeni `CatalogHandlers`): 3 read endpoint

**OpenAPI sync — minimal:**
- `info.version` 0.1.0 → 0.3.0
- `info.description` Faz 3 notu güncellendi
- 5 yeni tag: folders, items, admin, catalog, realtime
- **Detaylı path/schema'lar Faz 3 sonu polish PR'ında.** Mac elle TS tipleri yazıyor (PR-W1 fetch wrapper), tam spec'e bağımlı değil.

**Wire:**
- `httpapi.Deps.Catalog *CatalogHandlers`
- `cmd/api/main.go`: CatalogHandlers instance
- Router yeni route'lar `/api/v1/admin/audit-log` (admin gate) ve `/api/v1/{field-definitions, item-types, users/{id}/public-key}` (any-authed gate)

**Tests (~10 yeni case, toplam 191 PASS):**
- `httpapi/admin_audit_test.go`: buildAuditFilter (5 case: empty, all-fields, bad rtype, bad date, to-before-from) + validResourceType (8+4) + whereClause (empty + all-conditions placeholder check) + buildPageSQL (LIMIT/OFFSET advance) + emptyToNil (2 case)

DB-bound integration testler Faz 3 sonu testcontainers PR'ında.

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 191 case PASS (önceki 181 + 10 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Server tarafı Faz 3 BAĞIMLILIKLARI tamam:**
- ✓ /ws WebSocket hub (PR-10)
- ✓ Admin user mgmt + audit log query (PR-10/11)
- ✓ Catalog read (PR-11) — field/type/user-pubkey
- → Web tarafı için tüm REST + WS endpoint'leri hazır

**Sıradaki:** PR-W1 — Web foundation (API client + token storage + refresh rotation + layout + routing). Mac için PR-W3 başlamadan önce W1 + W2 (Win) tamamlanmalı.

### 2026-04-27 (Win) — Faz 3 PR-10: WebSocket hub + admin user mgmt endpoints

**Branch:** `feat/server-ws-admin` — review/merge bekliyor.

**Yeni paket: `internal/ws/`**

| Dosya | İçerik |
|-------|--------|
| `doc.go` | Architecture diagram + concurrency model + event payload felsefesi (minimal — client REST ile re-fetch eder, RBAC sızıntısız) |
| `events.go` | 9 Event type sabit (`folder.{created,updated,deleted}`, `item.{created,updated,deleted,shared,unshared,field_updated}`) + `Event{Type,ResourceID,ActorUserID,Timestamp}` + `NewEvent()` |
| `hub.go` | `Hub` (ctx + cancel + sync.RWMutex + connections map) + `NewHub` / `Close` (graceful) + `Register` / `Publish` (drop on overflow, no block) + `Stats` + `Accept`. `Connection` (id, userID, send chan, runReader, runWriter, ping ticker 30s, write timeout 10s) + `Closed()` channel + `closeOnce` |

**Critical karar: Hub kendi ctx'i kullanıyor.** Chi'nin `Timeout` middleware'i `http.TimeoutHandler` üstüne kurulu, Hijack'ı **desteklemez** → WebSocket upgrade kırılır. Çözüm: Hub'a kendi `context.WithCancel(context.Background())` kontekstini veriyorum, runReader/runWriter goroutine'leri buna anchor olur. Request ctx upgrade'den sonra kullanılmaz. `r.Context().Done()` yerine `c.Closed()` channel'ı ile parking yapıyoruz.

**Router refactor:** `Timeout(30s)` artık global değil. REST grupları (`/api/v1/auth`, `/folders`, `/items`, `/admin`) içinde `ar.Use(timeoutMW)` ile uygulanır. WebSocket route'u (`/api/v1/ws`) çıplak — uzun süreli bağlantı timeout-wrapper'sız.

**Yeni endpoint'ler (admin, RoleAdmin gerekir):**

`GET /api/v1/admin/users[?limit=&offset=]` (default 50, max 200)
- Pagination (limit + offset + total count). `array_agg + ORDER BY username`. Per-row `fetchUserRoles` çağrısı (small N — page max 200).
- Yanıt: `{users[], total, limit, offset}` her satır id/username/email/status/roles[]/last_login_at/created_at.

`POST /api/v1/admin/users/:id/disable`
- `users.status='disabled'` + tek tx içinde `RevokeAllUserSessions(reason='admin')`. Self-disable engeli.
- Idempotent (already-disabled → 204). Audit `admin.user_disabled`.

`POST /api/v1/admin/users/:id/enable`
- `status='disabled'`'dan recovery: TOTP verified varsa 'active', yoksa 'pending_totp' (tutarlılık koruması).
- Lockout reset etmez (ayrı concern). Idempotent. Audit `admin.user_enabled`.

`POST /api/v1/admin/users/:id/roles`
- Body: `{role: "admin"|"write"|"read"}`. ON CONFLICT DO NOTHING (idempotent re-grant).
- Audit `admin.role_granted` (target_user_id + role).

`DELETE /api/v1/admin/users/:id/roles/:role_name`
- **Self-strip-admin engeli:** kendi admin rolünü kaldıramaz (sistemde tek kalan admin'in kendini kilitlemesini önler).
- Idempotent. Audit `admin.role_revoked`.

**Yeni: `GET /api/v1/ws` (Bearer access in Authorization header)**
- JWT validate (purpose=access) → `websocket.Accept` (subprotocol `envanter.v1`) → Hub.Register → `<-c.Closed()` parking
- Reader: inbound frame'leri tüketir (MVP'de business message yok, sadece disconnect detection)
- Writer: send chan drain + 30s ping ticker (proxy/LB cull engeli)

**Hub.Publish entegrasyonu:**
- `FolderHandlers` + `ItemHandlers` artık `Hub *ws.Hub` field'ı taşıyor (nil-safe — `publishEvent` no-op ise)
- 9 endpoint mutate ettikten sonra `h.publishEvent(ws.EventXXX, resourceID, actorUserID)` çağırıyor
- Audit yazıldıktan sonra publish (audit tx commit'inden sonra, başarısız işlem broadcast etmez)

**Audit constants (4 yeni):**
- `admin.user_disabled`, `admin.user_enabled`, `admin.role_granted`, `admin.role_revoked`

**Yeni dependency:**
- `github.com/coder/websocket v1.8.12` (modern, context-aware, küçük API; gorilla/websocket archived)

**Wire:**
- `httpapi.Deps.Admin *AdminHandlers`, `Deps.WS *WSHandlers`
- `cmd/api/main.go`: hub erken yaratılır (defer Close), folder/item handlers'a Hub field'ı geçer, admin/ws handlers ayrı

**Tests (~7 yeni case, toplam 181 PASS):**
- `ws/hub_test.go`: Event field stamp + NewHub stats=0 + Publish-no-conns no-op + Close idempotent + 9 event constant pin
- `httpapi/admin_users_test.go`: validRoleName whitelist (3 valid + 5 invalid) + parseIntDefault clamping (8 case)

Handler-level DB integration testleri PR-11 sonrası testcontainers ile gelecek.

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 181 case PASS (önceki 174 + 7 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Sıradaki:** PR-11 — Server read API (audit query + field/type/user-pubkey + OpenAPI sync). Mac PR-W3 (admin UI) için backend hazır oluyor.

### 2026-04-26 (Win) — Faz 3 başlıyor: PR planlaması + Mac (Pro) ↔ Win iş bölümü

**Faz 2 BİTTİ** (PR-9 merge `08786e7`). Server tarafı tam fonksiyonel: register/TOTP/login/refresh/logout/change-pwd/recover + folder CRUD + item CRUD + paylaşım + RBAC + audit + brute-force guards. 174 unit test PASS, 17 migration, ~10K LOC.

**Faz 3 — Admin Web UI** başlıyor. Kullanıcı tarayıcıdan envanter işlemlerini yapabilir hale gelecek.

**Karar: Mac (Pro) ↔ Win paralel iş bölümü.**

Mac Pro paketi → daha az token. Self-contained ekran PR'ları Mac'e, mimari + entegrasyon Win'e. Win 5 PR, Mac 3 PR.

**Win (5 PR):**

| # | Branch | Kapsam | LOC | Sıra |
|---|--------|--------|-----|------|
| PR-10 | `feat/server-ws-admin` | Server: WebSocket hub `/ws` (access token gate, broadcast pub/sub) + admin user mgmt endpoints (list/disable/role-grant) | ~1000 | 1. |
| PR-11 | `feat/server-readapi` | Server: audit log query (admin, pagination + filter) + `GET /field-definitions` + `GET /item-types` + `GET /users/:id/public-key` + OpenAPI sync | ~700 | 2. |
| PR-W1 | `feat/web-foundation` | Web: API client SDK (fetch + token storage + refresh rotation) + layout (sidebar/topbar) + routing (auth-gate) + error mapping + toast | ~1100 | 3. |
| PR-W2 | `feat/web-auth` | Web: login + TOTP setup + recover screens + change-password modal | ~900 | 4. |
| PR-W6 | `feat/web-realtime-polish` | Web: WebSocket integration + i18n (Türkçe) + dark mode + responsive + a11y | ~800 | son (Mac PR-W5 sonrası) |

**Mac Pro (3 PR — self-contained ekranlar):**

| # | Branch | Kapsam | LOC | Bağımlılık |
|---|--------|--------|-----|------------|
| PR-W3 | `feat/web-admin` | Admin user list + role assign + disable/enable + audit log viewer (filter + pagination) | ~800 | PR-10, PR-11, PR-W2 |
| PR-W4 | `feat/web-inventory-read` | Folder tree (sol sidebar) + item list (orta panel, search box) + item detail panel (sağ, read-only) | ~1300 | PR-11, PR-W2 |
| PR-W5 | `feat/web-inventory-write` | Folder create/rename/delete + item create/edit form (field tipleri) + delete + paylaşım modal | ~1200 | PR-W4 |

**Toplam:** 8 PR, ~8000 LOC.

**Hız zinciri (5 günlük hedef):**

```
Gün 1: Win PR-10 (server WS+admin)
Gün 2: Win PR-11 (server read API) + PR-W1 (web foundation)
Gün 3: Win PR-W2 (auth) ║ Mac PR-W3 (admin) — paralel
Gün 4: Win bekler/Faz 5 prep ║ Mac PR-W4 (inventory read)
Gün 5: Win PR-W6 (websocket+polish) ║ Mac PR-W5 (inventory write)
       → FAZ 3 BİTER
```

**Çakışma koruması:**
- `server/**` → Win sahibi
- `web/**` → 3. gün öncesi Win, sonrası Mac (W3-W5 farklı route'lar)
- `shared/api/openapi.yaml` → Win (PR-11'de sync edilir)
- `PROGRESS.md` / `TODO.md` → ikisi de günlük entry yazar (tarih + makine etiketi)

**Erteleme (Faz 4-5'e):**
- Tauri client (Faz 4) — Win+Mac native
- Production hardening (Faz 5) — Sealed Secrets, Helm, observability, packaging
- item_relationships endpoint, field/type admin API → Faz 5 parking

**Sıradaki adım (Win):** PR-10'a başlıyorum — server WebSocket hub + admin endpoints.

### 2026-04-26 (Win) — Faz 2 PR-9: Item CRUD + item_shares + RBAC item resolver — **FAZ 2 SON HALKA**

**Branch:** `feat/server-item-crud` — review/merge bekliyor.

**Bu PR merge edilince Faz 2 BİTİYOR.** Server tarafında envanter işlemleri tam fonksiyonel: register → TOTP → login → folder CRUD → item CRUD → paylaşım. Faz 3 (Admin Web UI) buna bağlanmaya hazır.

**Yeni endpoint'ler (`internal/httpapi/item_*.go`):**

`POST /api/v1/items` (Bearer access)
- Body: `{id (UUID v7, client-gen), folder_id, item_type_id, name, fields[], owner_dek_wrapped, owner_wrap_nonce, external_source?}`
- **id client-generated UUID v7** (ADR-0004 §5.4): AAD-pending sorununu çözer. Server `gen_random_uuid()` kullanmaz — AAD bağlanması için id önceden bilinmeli.
- Folder Write check (admin bypass).
- **Two-layer envelope (ADR-0004 §6):**
  1. server_dek = 32B random (per-item)
  2. server_dek_wrapped = master.Seal(server_dek, AAD=`items:{id}:server_dek`)
  3. dekCipher = NewCipher(server_dek)
  4. name_enc = dekCipher.Seal(name, AAD=`items:{id}:name_enc`)
  5. name_search = HMAC-SHA256(name)[:16]
- Atomic tx: items INSERT + item_shares owner row (write, X25519 wrapped DEK from client) + item_fields[] INSERT.
- Field değerleri **client-encrypted** (E2E) — server `value_enc + value_nonce` blob'larını sadece saklar.
- Audit `item.created` (folder_id + item_type_id + field_count).

`GET /api/v1/items?folder_id=X[&q=...]` (Bearer access)
- folder_id zorunlu (DOS guard — tüm item'ları tek seferde dökmesin).
- folder Read check; reddedilirse boş list (existence oracle yok).
- q optional: `name_search = HMAC(q)` blind index lookup, deterministik eşleşme.
- Her satır için `ResolveItemPermission` → permission field'ı yanıta eklenir.

`GET /api/v1/items/{id}` (Bearer access)
- ResolveItemPermission Read check; reddedilirse 404 (oracle yok).
- name decrypt (DEK unwrap → DEK cipher.Open).
- Fields array_agg ile döner (client-encrypted blob'lar olduğu gibi).

`PUT /api/v1/items/{id}` (Bearer access)
- Rename + folder move + fields replace-all.
- Item Write check + (re-parent ise) destination folder Write check.
- Mevcut DEK reuse (rotate yok); name yeniden encrypt.
- `item_fields` DELETE + INSERT (replace-all semantik).
- Audit `item.updated`.

`DELETE /api/v1/items/{id}` (Bearer access)
- Write check. Schema CASCADE: item_fields, item_shares, item_relationships otomatik silinir.
- Audit `item.deleted`.

`POST /api/v1/items/{id}/shares` (Bearer access)
- Body: `{user_id, permission, dek_wrapped, wrap_nonce}`. UPSERT (re-share = update + revoked_at=NULL).
- `dek_wrapped` client'tan: owner kendi RAM'indeki DEK'i recipient'in pub_key'i ile X25519 sealed-box wrap'lar.
- Self-share engeli (owner zaten erişebilir).
- Audit `item.shared` (target_user_id + permission).

`DELETE /api/v1/items/{id}/shares/{user_id}` (Bearer access)
- Soft revoke. **Owner share koruması:** `target_user_id == items.created_by` ise 400 (item orphan'lanmaz).
- Idempotent. Audit `item.unshared`.

**Yeni `internal/auth/items.go`:**

`ResolveItemPermission(ctx, db, userID, itemID) ItemPermission`
- 3 sub-query (recursive CTE yerine — micro-bench: indexed PK lookup'lar daha hızlı):
  1. `items` row → folder_id + created_by (existence + owner check)
  2. `item_shares` direct grant (revoked_at IS NULL)
  3. `ResolveFolderPermission` (folder ancestor walk)
- Kombinasyon: max(owner=Write, share, folder) — Write ve Read birleşimi → Write.
- Owner ve direct-write short-circuit'leri (gereksiz folder query atlama).
- Item yoksa veya hiç grant yoksa → ItemPermNone.

`ItemPermission` tip + `AllowsRead/Write` semantiği.

**Yeni audit constants (6):**
- `item.created`, `item.updated`, `item.deleted`, `item.field_updated`, `item.shared`, `item.unshared`

**`extractNonce` refactor:** unused `nonceLen` parametresi kaldırıldı (her zaman `crypto.AESGCMNonceLen`). Çağıranlar güncellendi (auth_totp, folder_handlers, item_handlers).

**Wire:**
- `httpapi.Deps.Item *ItemHandlers`.
- `/api/v1/items/*` `RequireAccessToken` middleware altında.
- `cmd/api/main.go` ItemHandlers instance.

**Tests (~16 yeni case, toplam 174 PASS):**
- `auth/items_test.go`: ItemPermission.AllowsRead/Write matrix (6) + maxItemPerm (5) + folderPermToItemPerm (3) + ResolveItemPermission empty arg guard (2).
- `httpapi/item_handlers_test.go`: looksLikeUUID (3 valid + 6 invalid) + validateItemCreate (5 case) + nilIfEmpty (3) + nullableJSON (3) + fieldInputsToOutputs (2).

Handler-seviyesi DB integration testleri Faz 3 öncesi PR'ında testcontainers ile gelecek (real folder + item + share matrix).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 174 case PASS (önceki 158 + 16 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**🎯 Faz 2 tamamlanma kriterleri (PR-9 merge sonrası):**
- ✓ Auth surface (10 endpoint: register/totp/login/refresh/logout/logout-all/change-pwd/recover-init/recover-complete + tmp_token gate)
- ✓ Inventory CRUD (folder + item, RBAC enforced)
- ✓ Sharing (folder ACL + item_shares, X25519 sealed-box wrap)
- ✓ Audit log (24 action constant)
- ✓ Brute-force guards (rate limit + account lockout)
- ✓ E2E hibrit model: metadata server-side envelope, secret field'lar client-side
- ✓ 174 unit test PASS
- ⏸ WebSocket → Faz 3 (web UI ile birlikte)
- ⏸ item_relationships + field/type admin → Faz 5 (parking)

**Sıradaki:** Faz 3 — Admin Web UI. Mac (Pro) ↔ Win paralel PR planlaması. WebSocket de bu fazla geliyor.

### 2026-04-26 (Win) — Faz 2 PR-8: Folder CRUD + folder_permissions + RBAC ancestor walk

**Branch:** `feat/server-folder-crud` — review/merge bekliyor.

**Faz 2 son halkası 2'ye bölündü:** Eski tek-PR plan (Item + Folder + Relationships + WebSocket) çok büyüktü. Üç ertelemenin **mimari cost-of-delay analizi** sonucu (her biri 0 cost, schema hazır):

- WebSocket `/ws` → Faz 3 (web UI ile birlikte gerçek consumer çıkacak)
- Item relationships → Faz 5 / parking lot (00017 migration zaten kurulu, endpoint kolayca eklenir)
- Field definitions / item types admin API → Faz 5 (30 alan + 8 tip seed'li, MVP yeterli)

**Yeni bölünme:**
- **PR-8 (bu):** Folder CRUD + folder_permissions + RBAC folder resolver
- **PR-9 (sıradaki):** Item CRUD + item_shares + RBAC item resolver → **Faz 2 BİTECEK**

**Yeni endpoint'ler (`internal/httpapi/folder_*.go`):**

`POST /api/v1/folders` (Bearer access)
- Body: `{name, parent_id?, position}`. Server-side envelope encrypt name (master cipher, AAD=`folders:*:name_enc`) + HMAC blind index `name_search`.
- Permission gate: `parent_id IS NULL` (root folder) → admin only (ADR-0006 §3, sibling tree açma engeli). Aksi: `ResolveFolderPermission` Write check.
- Audit `folder.created` (parent_id details).

`GET /api/v1/folders[?parent_id=]` (Bearer access)
- parent_id boş → root folder list (her satır için Read check, görünmeyenler filtrelenir).
- parent_id set → o folder'ın altındaki çocuklar (önce parent Read check).
- Admin tüm satırları görür.
- Her response satırına `permission` field'i (UI hide-edit-buttons için).

`GET /api/v1/folders/{id}` (Bearer access)
- Read check; reddedilirse 404 (existence oracle yok).

`PUT /api/v1/folders/{id}` (Bearer access)
- Rename + re-parent. Re-parenting → BOTH source AND destination Write gerekir.
- Audit `folder.updated`.

`DELETE /api/v1/folders/{id}` (Bearer access)
- Write check. Schema CASCADE: alt folder'lar + item'lar + permissions otomatik silinir.
- Audit `folder.deleted`.

`POST /api/v1/folders/{id}/permissions` (Bearer access)
- Body: `{user_id, permission, inherit_to_children}`. UPSERT (re-grant aynı user için update + revoked_at=NULL geri set).
- Self-grant engeli (admin değilse, kendine yetki vermek anlamsız).
- Audit `folder.permission_granted` (target_user_id + permission + inherit).

`DELETE /api/v1/folders/{id}/permissions/{user_id}` (Bearer access)
- Soft revoke (revoked_at=now). Idempotent. Audit `folder.permission_revoked`.

**Yeni `internal/auth/folders.go`:**

`ResolveFolderPermission(ctx, db, userID, folderID) FolderPermission`
- Tek SQL CTE recursive: target folder'dan parent_id zinciri ile root'a kadar yürür.
- LEFT JOIN folder_permissions (revoked_at IS NULL).
- 4 bool aggregate: is_owner / has_write / has_read / folder_exists.
- Kural: `depth=0` (target folder) için inherit_to_children önemsiz; ata satırlar için sadece `inherit_to_children=true` count edilir.
- Return: FolderPermNone (existence oracle yok — folder yoksa veya yetki yoksa aynı), FolderPermRead, FolderPermWrite.

`FolderPermission` tip + `AllowsRead()` / `AllowsWrite()` semantiği (Write satisfies Read).

**Audit constants:**
- 5 yeni: `folder.created`, `folder.updated`, `folder.deleted`, `folder.permission_granted`, `folder.permission_revoked`
- `ResourceFolder = "folder"`

**Wire (`cmd/api/main.go` + `router.go`):**
- `httpapi.Deps.Folder *FolderHandlers` (optional, nil-safe).
- `/api/v1/folders/*` routes `RequireAccessToken(d.Auth.Service.JWT)` middleware altında.

**Tests (~8 yeni case, toplam 158 PASS):**
- `auth/folders_test.go`: FolderPermission.AllowsRead/Write matrix (6 case) + ResolveFolderPermission empty arg guard
- `httpapi/folder_handlers_test.go`: validateFolderRequest 3 case + nullableUUID 2 case

Handler-seviyesi DB integration test'leri PR-9'da Item CRUD ile birlikte testcontainers ile yazılacak (auth.DBExec mock'lamak yerine gerçek Postgres ile).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 158 case PASS (önceki 150 + 8 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-9 — Faz 2 son PR):**
- Item CRUD (metadata envelope + secret client-provided)
- Item field değerleri (envelope encrypt + AAD)
- item_shares + ResolveItemPermission (folder ancestor + per-item share birleşim)
- Item search (HMAC blind index, hostname/ip için)

**Sıradaki:** PR-9 — **Faz 2 son PR'ı**. Item CRUD + item_shares + RBAC item resolver.

### 2026-04-26 (Win) — Faz 2 PR-7: Change-Password + Recovery Flow + RBAC İskeleti + Session Binding Flag

**Branch:** `feat/server-auth-recovery` — review/merge bekliyor.

**Üç onaylanmış karar (kullanıcı ile mutabık kalındı):**

1. **Change-password = priv key re-wrap, public_key sabit.** Sebep: `item_shares.e2e_dek_wrapped` satırları kullanıcının public_key'i ile X25519 wrap'lı; pub değişirse hem kendi item'larındaki paylaşımlar hem ona paylaşılan item'lar erişilemez hale gelir. Master parola değişimi rutin bir işlem; veri kaybı kabul edilemez. Bu yüzden client priv key'i eski KEK ile açıp yeni KEK ile yeniden wrap eder, server sadece `private_key_enc + kek_salt + kek_params + version + rotated_at`'i günceller. Recovery'de ise zorunlu full keypair rotation olur (eski master pwd kayıp, eski priv açılamaz, item_shares accessibility kaybedilir — UI prominent uyarı).

2. **Recovery counter login ile paylaşılan.** Tek `users.failed_login_attempts` sütunu — yeni migration yok. Saldırgan login + recovery'i karıştırarak deneyemez (toplamda 10 hak). 10. denemede 30dk lock.

3. **RBAC bu PR'da sadece iskelet.** `RequireRole(allowed...)` middleware (admin bypass + role intersection) + `Permission` tipi + sabitler + `Allows(want)` semantiği. Item/folder DB resolver'lar PR-8'e (Item CRUD ile birlikte SQL'leri test edilebilir hale gelecek).

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/change-password` (Bearer access)
- Body: `{current_master_password, new_master_password, new_private_key_enc, new_kek_salt, new_kek_params}` — `public_key` YOK (sabit kalır).
- Current password verify → fail: `recordLoginFailure` (paylaşılan counter) + 401.
- Tek tx: users (password_hash + argon2_params + counter=0 + locked_until=NULL) + user_keypairs (priv_enc + kek_salt + kek_params + version++ + rotated_at) + `RevokeAllUserSessions('admin')` — tüm cihazlar yeni pwd ile yeniden login.
- Audit `auth.password_changed`. 204 No Content.

`POST /api/v1/auth/recover/init` (rate-limited, no auth)
- Body: `{username, recovery_code}`. Generic 401 (username enumeration kapalı).
- User lookup → unused recovery_codes (array_agg) → linear Argon2id verify (~10 max).
- Match → tek tx: code'u `used_at + used_ip` ile işaretle + `RevokeAllUserSessions('recovery')` + commit. Sonra `auth.PurposeRecovery` tmp_token (15dk).
- Audit `auth.recover` (step=init). Mismatch → `recordLoginFailure` + `auth.recover_fail`.

`POST /api/v1/auth/recover/complete` (Bearer tmp_token, purpose=recovery)
- Body: `{new_master_password, public_key (32B, YENİ), new_private_key_enc, new_kek_salt, new_kek_params}`.
- Tek tx: users güncelle (status='active' geri set) + user_keypairs FULL rotate (yeni pub + priv_enc + kek_*) + `DELETE FROM recovery_codes` + 10 yeni `INSERT recovery_codes` + defansif `RevokeAllUserSessions('recovery')`.
- Audit hem `auth.recover` (step=complete) hem `auth.password_changed` (via=recovery).
- Yanıt: `{recovery_codes: [...10 plain]}` — tek seferlik.

**Yeni middleware (`internal/httpapi/middleware_rbac.go`):**

| Tip / Fonksiyon | Açıklama |
|---|---|
| `Permission` (string alias) | `PermissionNone/Read/Write` — SQL CHECK ile lowercase uyumlu |
| `Permission.Allows(want)` | Write ⇒ Write only; Read ⇒ Read or Write satisfied |
| `RoleAdmin / RoleWrite / RoleRead` | Migration 00003 seed mirror |
| `RequireRole(allowed ...)` | chi middleware: admin bypass, otherwise claims.Roles ∩ allowed > 0 |
| `hasRole(claims, role)` | private helper |
| `writeMiddlewareForbidden` | 403 JSON envelope |

**Session binding flag (`auth_refresh.go` ek):**
- `auth.SessionRow` artık `UserAgent *string` + `IPAddress *string` (lookup sırasında `host(ip_address)::text`).
- `bindingChanged(row, currentIP, currentUA)` — nil-or-empty stored = match (no flag).
- Refresh handler: drift varsa `audit.ActionAuthSessionBindingChanged` (yeni constant) yazılır, blok yok.

**Yeni audit constants:**
- `ActionAuthSessionBindingChanged = "auth.session_binding_changed"`

**Router wire:**
- `/auth/recover/init` → brute RL altında (5 burst, sustained 1/12s).
- `/auth/recover/complete` → tmp-token gated, RL yok (token ömrü kısa zaten).
- `/auth/change-password` → access token gated, RL yok (saldırı için zaten geçerli token gerek).

**Tests (~24 yeni case, toplam 150 PASS):**
- `httpapi/middleware_rbac_test.go`: Permission.Allows matrix (6 case) + RequireRole NoClaims/AdminBypass/AllowedIntersect/NotInSet/EmptyClaims + hasRole 3 case
- `httpapi/auth_refresh_test.go`: bindingChanged BothMatch/IPMismatch/UAMismatch/NilStored/EmptyStored
- `httpapi/auth_change_password_test.go`: validateChangePassword 6 case (OK + 5 invalid)
- `httpapi/auth_recover_test.go`: validateRecoverComplete 6 case (OK + 5 invalid)

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 150 case PASS (önceki 126 + 24 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-8 — Faz 2 son PR):**
- Folder CRUD
- Item CRUD (metadata envelope + secret client-provided)
- Item share + folder_permissions
- `ResolveItemPermission(ctx, db, userID, itemID)` + `ResolveFolderPermission` (recursive ancestor walk SQL)
- Item relationships API
- WebSocket hub `/ws`

**Sıradaki:** PR-8 — Faz 2 son PR. Item CRUD + folder permissions effective resolver.

### 2026-04-26 (Win) — Faz 2 PR-6: Login + Refresh Rotation + Logout(-all) + Rate Limit + Lockout

**Branch:** `feat/server-auth-session` — review/merge bekliyor.

**Plan B genişletmesi:** PR-5 sonrası kalan auth çalışmasını **2'ye böldük** — PR-6 (session lifecycle) + PR-7 (change-password + recovery + RBAC). PR-6 single review unit olarak ~1100 LOC; PR-7'ye kadar geçen sürede session akışları test edilebilir hale geldi.

**Karar: tek-adım login.** `docs/auth-flow.md §3` `{username, password, totp_code}`'u tek body'de istiyor. MFA-bridge token (`mfa-required` purpose) eklemeyi düşünmüştüm, vazgeçtim — auth-flow.md'ye uyalım, fail mesajı zaten generic (oracle yok), 1 round-trip yeterli.

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/login`
- Body: `{username, master_password, totp_code}`. Generic 401 invalid_credentials her başarısız faktörde.
- Lookup user (lowercased username). Status check ('disabled' → 403, 'pending_totp' → 403 account_pending_totp, locked → 403 account_locked).
- Password verify (Argon2id, salt jsonb içinden `salt_b64`'ten). Fail → `recordLoginFailure` (counter++, 10'da lock 30dk).
- TOTP verify (envelope decrypt). Fail → counter++.
- Tüm faktörler OK: tx içinde `recordLoginSuccess` (counter=0, last_login_at=now) + `auth.CreateSession` + `fetchUserRoles` (array_agg) + commit. Access JWT (15dk, sessionID + roles) + opaque refresh (32B hex, 7g).
- Audit `auth.login` / `auth.login_fail` (reason: user_not_found / pending_totp / disabled / locked / wrong_password / wrong_totp).

`POST /api/v1/auth/refresh`
- Body: `{refresh_token}`. SHA-256 hash → sessions lookup.
- **Reuse detection:** Eğer matching row revoked_at IS NOT NULL ise → `RevokeAllUserSessions(reason='reuse_detected')` + `auth.refresh_reuse_detected` audit + 401.
- Expired check: row.ExpiresAt < now → 401 (cleanup cron 'expired' reason'la sweepleyecek).
- Happy path: tx içinde `RevokeSession(old_id, 'rotation')` + yeni session + audit `auth.refresh` (rotated_from kayıtlı). Yeni access + refresh dönülür.

`POST /api/v1/auth/logout` (Bearer access)
- `RevokeSession(claims.ID, 'logout')`. Idempotent (where revoked_at IS NULL). Audit `auth.logout`. 204 No Content.

`POST /api/v1/auth/logout-all` (Bearer access)
- `RevokeAllUserSessions(claims.Subject, 'logout_all')`. Audit `auth.logout_all`. 204 No Content.

**Yeni `internal/auth/`:**

| Dosya | İçerik |
|-------|--------|
| `lockout.go` | `MaxFailedLoginAttempts=10`, `LockoutDuration=30m`, `IsLocked(*time.Time)` (nil/zero/past = false; future = true, nowFn-pinnable) |
| `session.go` | `RevokeReason*` 7 sabit (CHECK constraint mirror), `SessionRow{ID,UserID,ExpiresAt,RevokedAt,RevokeReason}.IsActive(now)`, `DBExec` interface (Pool + Tx satisfies), `CreateSession`, `LookupSessionByRefreshHash`, `RevokeSession`, `RevokeAllUserSessions`, `TouchSession` |

**Yeni `internal/httpapi/`:**

| Dosya | İçerik |
|-------|--------|
| `auth_login.go` | `Login` handler + `userLoginRow` + `fetchUserForLogin/TOTPSecret/UserRoles` + `recordLoginFailure/Success` (CASE-based atomic counter+lock) + `extractSaltFromParams` |
| `auth_refresh.go` | `Refresh` handler + reuse detection + rotation tx |
| `auth_logout.go` | `Logout` + `LogoutAll` + `requireAccessToken` inline helper |
| `middleware_authn.go` | `RequireAccessToken(signer)` chi middleware → claims context'e koyar; `ClaimsFromContext` accessor; `CtxKeyClaims AuthContextKey` |
| `middleware_ratelimit.go` | `IPRateLimiter` (token bucket per-IP, sweep idle buckets); `Middleware` 429 + Retry-After header; `clientIP` (strip port post-RealIP) |

**`error.go`:** `writeInvalidCreds(w, logger, cause)` — kanonik 401 response (Türkçe generic msg).

**Router wire:**
- `/auth/login`, `/auth/refresh`, `/auth/totp/verify`: brute-force RL (5 burst, sustained 1/12s = ~5/min) — auth-flow.md §"Rate limit"'in (5/15dk) tighter sliding-window approximation.
- `/auth/logout`, `/auth/logout-all`: handler içinde `requireAccessToken` inline (audit log için missing-token vakası). Middleware versiyon ileride item endpoint'lerinde kullanılacak.

**Yeni dependency:**
- `golang.org/x/time v0.3.0` indirect → direct (rate.Limiter için)

**Tests (~40 yeni case, toplam 126 PASS):**
- `auth/lockout_test.go`: nil/zero/past/future + nowFn pin + policy constants
- `auth/session_test.go`: `IsActive` 3 case + `validRevokeReason` whitelist + nullables
- `httpapi/middleware_authn_test.go`: NoAuth / BearerPrefixMissing / BadToken / WrongPurpose (tmp token reddedildi) / HappyPath (claims ctx'te) / EmptyCtx
- `httpapi/middleware_ratelimit_test.go`: BurstAllowed / OverBurst429 / PerIPSeparation / RetryAfterHeader / clientIP 3 case
- `httpapi/auth_login_test.go`: `extractSaltFromParams` 4 case + `ptrStringOrEmpty`

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 126 case PASS (önceki 86 + ~40 yeni)
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues

**Bilinçli kapsam dışı (PR-7+):**
- `/auth/change-password` (password verify + new keypair + revoke all sessions)
- `/auth/recover/{init,complete}` (recovery code → tmp_token → new keypair, eski wrap'lı item_shares kaybedilir)
- RBAC middleware (`requireRole`, `requirePermission(folder|item)`)
- Session binding flag (UA/IP değişimi audit)
- WebSocket `/ws` access token gate

**Sıradaki:** PR-7 — change-password + recovery flow + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Faz 2 PR-5: Auth Primitives + Register + TOTP Enroll/Verify

**Branch:** `feat/server-auth-primitives` — review/merge bekliyor.

**Plan B (3 PR'a böldük):** Tek dev'li Faz 2 auth çalışmasını incremental review için 3 PR'a böldük:
- **PR-5 (bu):** Master key bootstrap + auth primitives (Argon2 wrapper, TOTP, JWT, refresh, recovery) + audit helper + Register + TOTP enroll/verify
- **PR-6 (sıradaki):** Login + refresh rotation + logout(-all) + change-password + recovery flow + RBAC middleware iskeleti
- **PR-7:** Item CRUD + folder permissions enforcement (Faz 2 sonu)

**Yeni: `server/internal/auth/` (~600 LOC + ~400 LOC test)**

| Dosya | Sorumluluk |
|-------|-----------|
| `keyloader.go` | `BootstrapMasterKey(ctx, db, key)` — fingerprint match (SHA-256), ilk boot v=1 insert, sonraki boot doğrulama |
| `password.go` | `HashPassword(plaintext)` + `VerifyPassword` — `crypto.HashPassword` üstüne ince persistance wrapper, `Argon2Params` JSON serialization |
| `totp.go` | RFC 6238 SHA-1 6-digit 30s ±1 skew; `GenerateTOTP(issuer, account)` → otpauth_uri + base32 secret; `VerifyTOTP(secret, code)` |
| `jwt.go` | HS256 `JWTSigner`; `IssueAccess` (15dk, purpose=access, sessionID + roles) + `IssueTmp` (15dk, purpose=totp-enroll/recovery) + `Parse(token, expectedPurpose)` |
| `refresh.go` | Opaque token: 32B random hex + SHA-256 hash + 7d TTL — DB'ye sadece hash kaydedilir |
| `recovery.go` | 10 kod × 8 hex byte (16 char); blob = `salt(16) ‖ argon2id_hash(32)`, constant-time verify |
| `service.go` | DI bundle: DB pool + Master cipher + MasterKey state + JWTSigner + SearchKey + IssuerName |

**Yeni: `server/internal/audit/` (~120 LOC)**
- `Writer.Write(ctx, Entry)` — best-effort INSERT INTO audit_log
- 12 Action konstantı: `auth.register`, `auth.totp_init`, `auth.totp_verified`, `auth.login`, `auth.login_fail`, `auth.logout`, `auth.logout_all`, `auth.refresh`, `auth.refresh_reuse_detected`, `auth.password_changed`, `auth.recover`, `auth.recover_fail`
- 3 Resource konstantı: `user`, `session`, `item`
- nullUUID/nullString/nullAddr helpers — empty → SQL NULL

**Yeni endpoint'ler (`internal/httpapi/auth_*.go`):**

`POST /api/v1/auth/register`
- Validasyon: username regex `^[a-zA-Z0-9._-]{3,64}$`, RFC 5322 email, password ≥12 char, public_key tam 32B
- 2-table tx: `INSERT users (status='pending_totp')` + `INSERT user_keypairs`
- `argon2_params` jsonb persist
- Audit `auth.register`
- Yanıt: `{user_id, tmp_token}` (purpose=totp-enroll, 15dk)

`POST /api/v1/auth/totp/init`
- Auth: bearer tmp_token (purpose=totp-enroll)
- Yeni 20B secret üret → master cipher Seal (AAD=`totp_secrets:{user_id}:secret_enc`)
- UPSERT `totp_secrets` (verified=false) — idempotent (yeniden çağrı eski secret'ı yenilemiş olur)
- Audit `auth.totp_init`
- Yanıt: `{otpauth_uri, secret_base32}`

`POST /api/v1/auth/totp/verify`
- Auth: bearer tmp_token (purpose=totp-enroll)
- Encrypted secret fetch → master cipher Open → `VerifyTOTP(secret, code)` (±1 window skew)
- 3-stmt tx: `UPDATE totp_secrets SET verified=true` + `UPDATE users SET status='active'` + 10× `INSERT INTO recovery_codes`
- Audit `auth.totp_verified`
- Yanıt: `{recovery_codes: [...10 plain]}` — **plaintext sadece bu yanıtta görünür**, sonra DB'de hash-only

**Shared: `internal/httpapi/error.go`**
- `ErrorResponse` (Code/Message/Details) — OpenAPI `Error` schema ile uyumlu
- 11 ErrCode konstantı (bad_request, unauthorized, invalid_credentials, invalid_mfa, invalid_code, invalid_token, account_locked, account_pending_totp, rate_limited, conflict, internal_error)
- `writeError(w, logger, status, code, userMessage, cause)` — userMessage Türkçe, cause sadece log'a (5xx için warn)
- `decodeJSON(w, r, logger, dst)` — 1 MiB body cap + DisallowUnknownFields

**Wire: `cmd/api/main.go`**
- Master key 32B kontrol → `auth.BootstrapMasterKey` → `auth.New(ServiceConfig{...})` → `audit.NewWriter(pool)` → `httpapi.AuthHandlers{Service, Audit, Logger}`
- Router `Deps.Auth != nil` ise `/api/v1/auth/{register, totp/init, totp/verify}` mount eder

**Config: `internal/config/config.go`**
- `MasterKey []byte` + `JWTSecret []byte` alanları
- `decodeMasterKey(b64)` — base64.StdEncoding 32B
- `RequireSecrets()` — secret'lar boşsa fail-fast (production safety)

**Test sayısı:** Yeni 18 unit test (`auth/{password,jwt,totp,refresh,recovery}_test.go` + `httpapi/error_test.go`). Tüm paketlerde toplam **86 unit test** (önceki 68 + 18 yeni).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓
- `gofmt -l .` clean
- `golangci-lint run --timeout=5m ./...` 0 issues (gosec G101 false positive `nolint` ile kapatıldı — `ErrCodeInvalidCreds` error-code identifier, secret değil)

**Bilinçli kapsam dışı (PR-6+):**
- `/auth/login` (password verify + TOTP step + session create + access+refresh issue)
- `/auth/refresh` (rotation + reuse detection)
- `/auth/logout`, `/auth/logout-all`
- `/auth/change-password`
- `/auth/recover/{init,complete}` (recovery code → new keypair)
- RBAC middleware (`requireRole`, `requirePermission`)
- Item CRUD (PR-7)

**Sıradaki:** PR-6 — login/refresh/logout/change-password/recovery + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Faz 2 PR-4: Crypto Package

**Branch:** `feat/server-crypto` — review/merge bekliyor.

**Yeni: `server/internal/crypto/` (~520 LOC + ~700 LOC test)**

| Dosya | Sorumluluk |
|-------|-----------|
| `doc.go` | Threat model, koruyduklar/koruyamadıkları, paket sınırları |
| `format.go` | Versionlu blob layout `[v][alg][nonce][ct+tag]` + AAD helpers + RandomBytes |
| `aesgcm.go` | `Cipher` (AES-256-GCM Seal/Open) — random nonce, AAD bound, error-wrapping |
| `envelope.go` | `GenerateDEK()` 32B + ADR-0004 §6 envelope kullanım örneği doc |
| `argon2.go` | Argon2id `HashPassword`, `VerifyPassword` (constant-time), `DeriveKey` (KEK), `Argon2Params.Validate` |
| `sealedbox.go` | X25519 sealed-box: ECDH + HKDF-SHA256 + AES-256-GCM (NaCl crypto_box_seal pattern, anonymous-sender) |
| `searchhash.go` | `DeriveSearchKey` (HKDF) + `SearchHash` (HMAC-SHA256, lowercase, 16-byte truncated) |

**Algoritma uyumluluğu (ADR-0004):**
- AES-256-GCM (12B nonce, 16B tag, AEAD authenticated)
- Argon2id (default t=3, m=64MiB, p=4, salt 16B, key 32B)
- X25519 (`crypto/ecdh`) + HKDF-SHA256 (`golang.org/x/crypto/hkdf`)
- HMAC-SHA256 (truncate-to-128-bit) for searchable encryption

**Tehdit modeli güvenceleri (testlerle doğrulandı):**
- ✓ Wrong-key cross access → fail
- ✓ Wrong-AAD substitution attack → fail
- ✓ Tampered ciphertext (1 bit flip) → fail
- ✓ Algorithm-byte mismatch → fail
- ✓ Sealed-box: yanlış alıcı priv ile open → fail
- ✓ Argon2 KAT: aynı (password, salt, params) → byte-identical
- ✓ Constant-time password compare (`subtle.ConstantTimeCompare`)

**Test sayısı:** 42 unit test (crypto paketi). Tüm paketlerde toplam **68 unit test** (önceki 26 + 42 yeni).

**Yeni dependency:**
- `golang.org/x/crypto v0.17.0` (zaten indirect idi pgx üzerinden; argon2 + hkdf için direct'e geçti)

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ 68 unit pass (cache hit'leri dahil)
- `gofmt -l .` clean
- `golangci-lint run ./...` 0 issues

**Bilinçli kapsam dışı (sonraki PR'larda):**
- Master key loader (KMS / k8s Secret okuma + master_keys tablo entegrasyonu) → PR-5'te `internal/auth` ile birlikte
- sqlc query'leri (auth + items) → PR-5+
- Crypto kullanan endpoint'ler (register/login) → PR-5

**Sıradaki:** PR-5 — auth endpoints (register, TOTP enroll/verify, login, refresh, logout, change-password, recovery) + master key bootstrap + RBAC middleware iskeleti.

### 2026-04-26 (Win) — Mac M4 paused, PR-3 merged, tracking sync

- **PR-3 merged** (commit `cf2b63c`, PR #4) — 12 migration + testcontainers integration test main'de.
- **Mac M4 ⏸ paused** — kullanıcı şimdilik tüm geliştirmeyi Win'den yürütüyor. Mac yeniden devreye alınırsa bilgi verilecek. RULES.md'deki "Çift makine workflow" hâlâ geçerli olarak kayıtlı (Mac dönerse aynı pattern), ama mevcut "deploy direct to main" pattern'i şu an Win'de yok — geliştirme tamamen PR akışı.
- Bu commit tracking MD'leri PR-3 merge sonrası state'e + Mac pause notu ile sync ediyor.
- **Bir sonraki:** PR-4 — `internal/crypto` package (envelope encrypt/decrypt + Argon2id + X25519 sealed-box + searchable HMAC + known-answer tests).

### 2026-04-25 (Win) — Faz 2 PR-3: Migration'lar + Integration Test

**Branch:** `feat/server-migrations` — review/merge bekliyor.

**12 yeni migration** (dependency order):
- `00006_master_keys` — envelope encryption hierarchy root, single-active partial index
- `00007_user_keypairs` — X25519 keypair, KEK salt + Argon2id params
- `00008_totp_secrets` — RFC 6238, server-side envelope, verified consistency check
- `00009_recovery_codes` — Argon2id-hashed 10/user, partial index unused
- `00010_item_types` + 8 seed (server, url, database, ssh_key, certificate, cloud_credential, note, generic)
- `00011_field_definitions` + 30 seed (hostname, ip_address, password, environment enum, criticality enum, ...)
- `00012_folders` — tree (parent_id self-ref), name_search HMAC, updated_at trigger
- `00013_folder_permissions` — 3-katmanlı RBAC katmanı, inherit_to_children, partial index
- `00014_items` — UUID v7 client-gen, external_source jsonb (Vault hazır), partial index external_type
- `00015_item_fields` — field_definition_id FK, value_enc nullable (external_source bypass), unique (item, def)
- `00016_item_shares` — per-user wrapped DEK, partial indexes active
- `00017_item_relationships` — 5 edge type, composite PK, self-loop CHECK

**Integration test framework (testcontainers-go):**
- `internal/db/migrations_integration_test.go` (build tag `integration`)
- Postgres 16 container — fresh DB
- Phase 1: `goose up` (tüm 17 migration)
- Phase 2: `goose down to 0` (geri çevirme)
- Phase 3: `goose up` tekrar (idempotency)
- Seed validation: 3 roles, 8 item_types, ≥25 field_definitions
- Spot-check: hostname/environment/criticality keys + enum allowed_values
- 5 dakika global timeout, 60sn container start timeout

**CI yeni job: `server-integration`**
- `runs-on: ubuntu-latest`, Docker hazır
- `needs: [server]` — unit testler önce yeşil olmalı
- Go 1.23 (golangci-lint binary uyumluluğu için pin'lendi)
- `go test -tags=integration -timeout=10m ./internal/db/...`

**Makefile:**
- `make test-integration` hedefi eklendi

**sqlc queries (minimal):**
- `field_definitions.sql` — List, GetByKey, GetByID, Create
- `item_types.sql` — List, GetByKey, GetByID, Create
- (item CRUD ve auth query'leri PR-4+'da)

**Yeni Go deps:**
- `github.com/testcontainers/testcontainers-go v0.30.0` (test-only)
- `github.com/testcontainers/testcontainers-go/modules/postgres v0.30.0`
- `github.com/pressly/goose/v3 v3.22.0`

`go.mod` direktifi `go 1.22` korundu (testcontainers v0.30.0 + goose v3.22.0 uyumlu).

**Lokal validation (Win, Go 1.26.2 + golangci-lint v1.62.2):**
- `go build ./...` ✓
- `go test ./...` ✓ (28 unit test, integration tag yok)
- `gofmt -l .` clean
- `golangci-lint run ./...` 0 issues
- Integration test (Docker yokken) lokal'de çalışmaz; CI'da koşacak

**Mac tarafı etkisi (merge sonrası):**
- Docker build → GHCR yeni image (12 yeni migration embed'li)
- ArgoCD auto-sync → api Deployment image refresh
- Init container yeni migration'ları otomatik uygular
- `kubectl logs envanter-api-* -c migrate` ile doğrulanır

### 2026-04-25 (Win) — Faz 2 PR-2: DB layer + chi router

**Branch:** `feat/server-db-chi` — review/merge bekliyor.

**Önkoşul:** Win'de Go 1.26.2 kuruldu (`C:\Program Files\Go\`).

**İçerik:**

- **`internal/db`** (yeni) — pgx v5 `pgxpool` wrapper:
  - `Config` struct: URL, MaxConns, MinConns, HealthCheckInterval
  - `Validate()`: URL boş, min<0, max<min, üçü için error mesajları
  - `New(ctx, cfg)`: parse → pool yarat → ilk Ping (5sn timeout) → fail fast davranışı
  - 5 unit test (config validation; live DB testleri PR-3+'da testcontainers-go ile)

- **`internal/httpapi`** (genişletildi) — chi router + middleware stack + handlers:
  - `NewRouter(Deps)` chi router döner; 6 middleware sırası: RequestID → echoRequestIDHeader (yeni helper) → RealIP → slogRequestLogger → Recoverer → Timeout(30s)
  - `slogRequestLogger`: her request için tek satır JSON log; **/healthz ve /readyz log spam'i için filtrelenir** (k8s probe'ları sürekli çağırır)
  - `DBPinger` interface — pgxpool.Pool satisfies; testlerde fake injection
  - `/healthz`: liveness probe, sadece process alive (200 OK)
  - `/readyz`: readiness probe, **2sn timeout ile DB Ping**; fail → 503 + log warn
  - 6 test: /healthz 200, /readyz DB OK 200, /readyz DB down 503, X-Request-Id header echo, 404 unknown path, 405 POST /healthz

- **`cmd/api/main.go`** (refactor) — config + logging + db pool + chi router birlikte wire edildi. Graceful shutdown korundu.

- **`server/go.mod` + `go.sum`** — yeni deps: `github.com/go-chi/chi/v5 v5.2.5`, `github.com/jackc/pgx/v5 v5.9.2` + indirect (puddle, pgpassfile, pgservicefile, x/sync, x/text). `go 1.25.0` directive (pgx v5.9.2 minimum).

- **`go.work`** — `go 1.22` → `go 1.25.0` (workspace go directive must be ≥ module).

- **`.github/workflows/ci.yml`** — Go matrix `1.22` → `stable` (setup-go'nun son stable Go'su; pgx 1.25+ gerekli).

**Lokal doğrulama (Win, Go 1.26.2):**
- `go build ./...` ✅
- `go vet ./...` ✅
- `go test ./...` ✅ — 28 test, 0 fail (config 9 + db 5 + httpapi 6 + logging 8)
- `gofmt -l .` boş (CRLF→LF auto-fix sonrası)
- Binary boyut: 13.1 MB (server/cmd/api)

**Bilinçli kapsam dışı (PR-3+'a bırakıldı):**
- testcontainers-go ile DB integration test (gerçek migration up/down)
- Auth endpoints (Argon2id + TOTP + JWT)
- Faz 2 ek migration'lar (00006-00017)
- Crypto package (`internal/crypto`)
- WebSocket hub

### 2026-04-25 (Win catch-up) — Tracking sync sonrası BFG history purge

Mac M4'te yapılan kapsamlı çalışmalardan sonra Win local repo'su `git reset --hard origin/main` ile remote'a hizalandı (BFG history purge'u sonrası tüm commit hash'leri yeniden yazılmıştı: `b35a46c → 21bd3df → 242cf40 → cb87259`, vs.).

**Mac'in tamamladıkları (özet):**
- PR-1 merge (`cb87259`)
- CI optimizasyonu: 1+ saat → 5dk
- Secret rotation + history purge (`daa48d0` + BFG)
- DB migration init container (`9ea420b`) — `goose` binary embed + `/migrations` copy + initContainers entry
- Server Dockerfile native cross-compile (`a89ac83` + `3bbb077` + `89be3c2`) — QEMU yok, ~8dk multi-arch
- Tag'ler: `v0.1.0-dev`, `v0.1.1-dev`
- Cluster doğrulama: tüm pod 1/1 Running, /healthz 200 OK

**Win catch-up commit'i (bu):**
- PROGRESS.md "Mevcut Durum" + Faz Durumu tablosu güncellendi (PR-1 merged, secret bloker resolved, Faz 5 PARTIAL detayı genişletildi)
- TODO.md "Aktif" bölümü ve kritik secret rotation [x] işaretleri tamamlandı
- ADR-0008 "Plaintext Secret'lar" bölümüne RESOLVED notu
- CLAUDE.md kapsam bölümüne migration init container eklendi
- Bloker / Risk listesi sadeleşti

### 2026-04-25 (Mac, geç saat) — CI Docker job optimizasyonu

PR-1 merge sonrası docker job 1+ saat sürdü (QEMU multi-arch). Çözüm:
- main push → amd64-only (~5dk): QEMU emülasyon yok, hızlı feedback
- `v*` tag push → multi-arch amd64+arm64 (release distribution için, M4 uyumlu)
- `:main-<sha7>` tag eklendi reproducibility için (`:latest` anti-pattern kısmen çözüldü, ADR-0008 notu)
- Cache scope per image (`scope=api` / `scope=web`) — bir image değişince diğerinin cache'i geçerliliğini koruyor
- `on.push.tags: ['v*']` eklendi — tag push'larda CI tetikleniyor

### 2026-04-25 (Mac M4) — Git history purge (BFG)

- BFG 1.15.0 ile `deploy/k8s/secret.yaml` tüm git history'den silindi
- Bare mirror clone → BFG → `git reflog expire` + `git gc --prune=now --aggressive` → force push
- Remote (GitHub) doğrulandı: eski commit'lerde artık `secret.yaml` içeriği yok
- Lokal repo da temizlendi (gc sonrası `git log --all --full-history -- secret.yaml` boş döndü)
- Win Claude session'ı `git pull` / re-clone yapmalı (hash'ler değişti)

### 2026-04-25 (Mac M4) — Secret rotation + .gitignore

- `deploy/k8s/secret.yaml` git tracking'den çıkarıldı (`git rm --cached`)
- `.gitignore`'a `deploy/k8s/secret.yaml` ve `deploy/k8s/*-secret.yaml` eklendi
- `deploy/k8s/secret.yaml.example` placeholder template commit'lendi
- Yeni `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD`, `ENVANTER_DB_URL` üretildi (32/32/24 byte random base64)
- Cluster'da `kubectl create secret generic envanter-secret` ile apply edildi
- Postgres PVC sıfırlandı (test ortamı, fresh start) → StatefulSet + API pod'ları restart
- `configmap.yaml`'dan plaintext `ENVANTER_DB_URL` kaldırıldı; parça parça env'lere bölündü (`ENVANTER_DB_HOST/PORT/NAME/USER/SSLMODE`)
- `ENVANTER_DB_URL` artık Secret'tan geliyor (`kubectl create secret` ile)
- *Hâlâ TODO:* Git history'den eski secret'ları purge (BFG / git filter-repo) — ayrı task
- *Hâlâ TODO:* Sealed Secrets / External Secrets Operator adoption (Faz 5)

### 2026-04-25 — Cross-machine deploy work (Mac M4, paralel Claude session) — backfill

Bu entry, **Mac M4 üzerinde paralel olarak yapılan deploy çalışmasının** geriye dönük dokümantasyonu (RULES.md tracking discipline kuralı için). Çalışmayı yapan: Burak Haşlaman + Claude Sonnet 4.6 (Mac session).

**4 commit (sıralı):**

| Commit | Açıklama |
|--------|---------|
| `9d8894f` | feat: add Dockerfiles, k8s manifests, and GHCR CI pipeline |
| `48920ac` | fix: allow multi-document YAML in pre-commit + add ArgoCD Application |
| `002a9e3` | fix: add imagePullSecrets for GHCR private registry |
| `38c784e` | fix: build multi-platform images (amd64 + arm64) for M4 compatibility |

**Eklenen / değişen:**

- **`server/Dockerfile`** — Go multi-stage (golang:1.22-alpine → scratch); CGO disabled, ~20MB image
- **`web/Dockerfile`** + **`web/nginx.conf`** — Vite build → nginx; `/api` proxy + `/ws` WebSocket + SPA fallback
- **`deploy/k8s/`** (9 dosya) — namespace, configmap, secret, postgres (StatefulSet+PVC), api, web (NodePort 30830), adminer, mailhog, argocd-app
- **`.github/workflows/ci.yml`** — yeni `docker` job (push to main only): GHCR login + buildx + multi-arch push (amd64 + arm64); cache=gha
- **`.pre-commit-config.yaml`** — `check-yaml` için `--allow-multiple-documents` (k8s manifest'ler `---` içerir)
- **ADR-0008 (bu commit'te)** — Containerization + raw k8s + GHCR + ArgoCD GitOps. ADR-0001'in Helm tercihinden farklılaşma.

**Pattern:**
- main'e push = CI → Docker images (api, web) GHCR'a push → ArgoCD detect (polling) → envanter namespace sync. Tam GitOps.
- Multi-arch sayesinde Mac M4'te `kubectl run` veya kind/k3d ile yerel test sorunsuz.

**⚠️ Kritik bulgular ve yapılacaklar:**

1. **`deploy/k8s/secret.yaml` plaintext secret içeriyor** — `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD` repo'da görünür. Repo private olsa bile sektör pratiği ihlali. **Acil aksiyonlar:**
   - Master key + JWT secret rotate (yeni rastgele 32B üret)
   - `secret.yaml`'ı `.gitignore`'a ekle
   - `secret.yaml.example` placeholder commit
   - Git history'den eski secret'ları purge (`git filter-repo` veya BFG)
   - Sealed Secrets / External Secrets / SOPS adoption (Faz 5)
2. `:latest` tag — git SHA / semver tag pin'lemesi gerekir (Faz 5)
3. Resource limits, HPA, Ingress, TLS, NetworkPolicy, Pod Security Standards eksik — Faz 5'e taşındı
4. DB migration init container yok — api Deployment'ına eklenmeli (Faz 2 PR-2 veya PR-3'te)

**Gözlem:** Pre-commit'in `gitleaks` hook'u secret leak'i yakalayamadı (k8s YAML secret kategorize etmedi). `gitleaks` config'ine custom rule eklenmesi düşünülecek.

### 2026-04-24 — Proje başlangıcı + Faz 0 tamamlandı
- Gereksinimler ve hedef netleşti (envanter app, DevOps/SRE takımı için, KeePassXC replacement).
- Tech stack kararı alındı: Go + Tauri + PostgreSQL 16 + monorepo (ADR-0001).
- Güvenlik modeli **hibrit** olarak belirlendi (ADR-0002):
  - Metadata → server-side envelope encryption
  - Secret field'lar → client-side E2E
  - Audit log → server-side plaintext
- Monorepo layout kararlaştırıldı (ADR-0003).
- 6 fazlı yol haritası çıkarıldı (tahmini 5-7 hafta).
- İlerleyiş takip dosyaları oluşturuldu: `CLAUDE.md`, `PROGRESS.md`, `RULES.md`, `TODO.md`.
- **Faz 0 kod iskeleti tamamlandı:**
  - Monorepo dizin yapısı (server/, client/, web/, shared/, deploy/, docs/, .github/)
  - Root config: `.gitignore`, `.editorconfig`, `README.md`, `LICENSE`, `Makefile`, `.env.example`, `go.work`
  - Go server: `cmd/api/main.go` (healthz endpoint, graceful shutdown), 7 internal paketi için doc.go
  - Docker Compose: Postgres 16 + Adminer + Mailhog
  - Linting: `.golangci.yml` + `.pre-commit-config.yaml` (gitleaks dahil secret tarama)
  - CI: `.github/workflows/ci.yml` — server job (gofmt + go mod tidy + golangci-lint + build + test -race) + pre-commit job
  - 3 ADR: tech-stack, security-model, repo-layout
  - Web scaffold: Vite + React 18 + TS + ESLint + Prettier
  - Tauri scaffold: Cargo.toml + tauri.conf.json + main.rs + lib.rs + Vite+React frontend
  - `docs/smoke-test.md` kullanıcı için doğrulama kılavuzu
- **Not:** Lokal dev ortamında Go/Node/Rust/Docker kurulu değil — smoke test user'ın kendi makinesinde yapılacak.

### 2026-04-24 (2. iş günü) — Faz 1 tasarım + implementasyon
- Repo lokal git'e alındı (`Desktop/Repos/Envanter_App`), ilk commit `c65a4be`.
- **Faz 1 — Veri modeli + kripto tasarımı tamamlandı.** Sıralı iş:
  1. ER diyagramı (Mermaid, 11 tablo). `users`, `user_keypairs`, `totp_secrets`, `recovery_codes`, `sessions`, `roles`, `user_roles`, `master_keys`, `folders`, `items`, `item_fields`, `item_shares`, `audit_log`.
  2. ADR-0004 — Şifreleme detayları: AES-256-GCM (nonce 12B, tag 16B, versiyonlu blob formatı), Argon2id (t=3, m=64MiB, p=4), X25519 sealed-box key wrap, HMAC-SHA256 search. Key hierarchy: KMS/Secret → master_key → server_dek (metadata); user_password → KEK → user_priv → e2e_dek (secrets).
  3. ADR-0005 — `goose` seçildi. SQL-first, embed, review-friendly. Atlas değerlendirildi, ekip tercihinde review-first felsefesine uymuyor.
  4. Auth akış dokümantasyonu — 9 senaryo Mermaid sequence ile. Register + TOTP enroll + login + refresh rotation + auto-lock + logout + password change + recovery + admin reset.
  5. **Review çıktıları (6 karar):**
     - UUID v7 client-üretimli ✓
     - MFA zorunlu; login'de TOTP, unlock'ta sadece master password
     - Recovery code → yeni keypair (solo item kaybı kabul, UI'da prominent uyarı)
     - Auto-lock default 10dk (5/10/15/30 configurable)
     - Searchable encryption HMAC hash — frequency leak kabul
     - Session binding = flag (block değil); token reuse detection → tüm session'lar revoke
  6. 5 migration (`00001` init extensions + `00002` users + `00003` roles + `00004` sessions + `00005` audit_log). pgcrypto, `set_updated_at()` trigger, CHECK constraints, partial index'ler, BRIN index audit_log'da.
  7. OpenAPI 3.1 spec — `shared/api/openapi.yaml`. Health + 10 auth endpoint (register, TOTP init/verify, login, refresh, logout, logout-all, change-password, recover/init, recover/complete).
  8. Code gen pipeline: `sqlc.yaml` + 4 query dosyası (users/sessions/roles/audit_log), `oapi-codegen.yaml`, Makefile `gen`/`gen-sqlc`/`gen-oapi-go`/`gen-oapi-ts`/`gen-check` hedefleri. `tools-install` hedefiyle Go tool'ları pin versiyonlu.

### 2026-04-24 (3. iterasyon) — Faz 1 genişleme: UX + RBAC + Vault tasarımı

Kullanıcı review sırasında ürün için 4 ek boyut tanımladı; hepsi için tasarım kararları alındı, belgeler güncellendi. **SQL migration'ları Faz 2'ye bırakıldı** (sadece admin rolü eklemesi 00003'te).

**Karar özeti:**
- **Objeler arası link** (`item_relationships` tablosu) — 5 edge tipi: `hosted_on`, `accessed_via`, `part_of`, `related_to`, `depends_on`. DevOps topolojisini yansıtır (DB ↔ sunucu, jump server zinciri).
- **Item tipleri** (`item_types` ayrı tablo, enum değil) — admin yeni tip ekleyebilir. 8 seed: server / url / database / ssh_key / certificate / cloud_credential / note / generic. Her tipin `suggested_fields` ve `default_launchers` (Faz 4) metadata'sı var.
- **Merkezi field sözlüğü** (`field_definitions` tablosu) — hostname/host_name drift'ini engeller. Type-to-search autocomplete UI'da. `field_type` içinde `enum` desteği (`allowed_values jsonb`) — `environment` (prod/stage/test/dev/lab) ve `criticality` (critical/high/medium/low) seed'li. `is_secret` artık tanımın parçası (E2E mi envelope mi otomatik).
- **3-katmanlı RBAC** — ADR-0006 §4:
  1. Global rol: `admin` / `write` / `read` (3 rol; admin rolü eklendi, 00003 revize)
  2. Klasör-level ACL: `folder_permissions` tablosu, `inherit_to_children`
  3. Item-level share: mevcut `item_shares`
  - Effective permission hesabı auth-flow.md'de pseudocode olarak.
- **External secret backends** (ADR-0007) — HashiCorp Vault **proxy** modeli:
  - Envanter Vault'tan DB'ye yazmaz, passthrough eder (E2E modeli bozulmaz)
  - `items.external_source jsonb` kolonu path referansı tutar
  - Kubernetes auth (k8s SA → Vault AppRole) MVP; OIDC SSO parking lot
  - Dynamic secrets (15dk kısa ömürlü DB cred) Faz 5+ bonus
  - **Manuel linking only** (MVP) — auto-discovery parking lot
- **Organizational convention** — proje/ortam folder düzeni + `environment` field cross-cutting sorgu için.

**Güncellenen dosyalar (9):**
- `docs/diagrams/er.mmd` — 17 tabloya çıktı (yeni: item_types, field_definitions, folder_permissions, item_relationships; modifiye: items +external_source, item_fields ↔ field_definitions)
- `docs/adr/0006-data-model-extensions.md` — YENİ
- `docs/adr/0007-external-secret-backends.md` — YENİ
- `docs/adr/README.md` — 0006 + 0007 index'e
- `docs/auth-flow.md` — RBAC 3 katman + endpoint matrix genişletildi
- `server/migrations/00003_roles.sql` — admin rolü seed'e
- `CLAUDE.md` — RBAC katmanları + Vault notu
- `PROGRESS.md` — bu entry
- `TODO.md` — Faz 2 migration listesi + Parking Lot güncellendi

### 2026-04-24 (4. iterasyon) — Repo konumu kuralı + tracking disiplini

- Claude-Chat / Repos divergence sorgulandı; yön netleştirildi: **Repos canonical, Claude-Chat legacy/donmuş**.
- `RULES.md`'ye yeni "Repo Konumu ve Tracking Dosyaları" bölümü eklendi:
  - Canonical dizin: `Desktop/Repos/Envanter_App`. Tüm yazılar absolute path ile bu konuma.
  - **Push öncesi zorunlu tracking güncelleme** matrisi (PROGRESS / TODO / CLAUDE / RULES / ADR / ER / OpenAPI). Asıl iş commit'i ile aynı commit'te.
  - Ayrı "docs commit" ANTI-PATTERN sayılır (review yükünü ikiye katlar).
- Bu kural pratikte zaten uygulanıyordu (Faz 1 commit'i bunu izlemişti); şimdi sözleşme yazılı.

## Mimari Kararlar (Özet)

| No | Karar | Durum |
|----|-------|-------|
| 0001 | Tech stack: Go + Tauri + Postgres + monorepo | Kabul (2026-04-24) |
| 0002 | Güvenlik modeli: hibrit (server-side envelope + client-side E2E) | Kabul (2026-04-24) |
| 0003 | Repo layout: monorepo | Kabul (2026-04-24) |
| 0004 | Şifreleme detayları: AES-256-GCM + Argon2id + X25519 + HMAC search | Kabul (2026-04-24) |
| 0005 | Migration tool: goose | Kabul (2026-04-24) |
| 0006 | Veri modeli: item_types, field_definitions, folder_permissions, item_relationships + admin rolü | Kabul (2026-04-24) |
| 0007 | External secret backends: Vault proxy (manuel linking, Faz 5 impl) | Kabul (2026-04-24) |
| 0008 | Containerization + raw k8s + GHCR + ArgoCD (Helm yerine, ADR-0001 deploy satırını değiştirir) | Kabul (2026-04-25) |

## Bloker / Risk / Not

- **2026-04-24:** Win lokal makinede Go, Node, Rust, Docker kurulu değil — CI'a push edilene kadar gerçek build/test verifikasyonu yok. Kullanıcı `docs/smoke-test.md`'deki adımları lokal dev makinesinde çalıştırmalı.
- Tauri iconları (Faz 4'te) eklenmeden `tauri:build` warning verebilir. `tauri:dev` sorunsuz çalışır.
- `go.sum`, `package-lock.json`, `Cargo.lock` henüz yok — ilk `go mod tidy` / `npm install` / `cargo build` komutlarında üretilecek ve commit'lenecek.
- **Faz 1 sonu:** Migration'lar Postgres üzerinde çalıştırılmadı (lokal ortam yok). Kullanıcı `make migrate-up` ile doğrulamalı.
- Code gen henüz çalıştırılmadı; `server/internal/db/sqlcgen/`, `server/internal/httpapi/apigen/`, `web/src/api/schema.gen.ts`, `client/src/api/schema.gen.ts` dosyaları yok. `make gen` ilk kez çalıştırıldığında üretilecek ve commit'lenmeli (CI `make gen-check` ile drift'i yakalar).
- ~~**🚨 KRİTİK 2026-04-25:** `deploy/k8s/secret.yaml` plaintext.~~ **ÇÖZÜLDÜ 2026-04-25 (Mac):** Rotate + `.gitignore` + BFG history purge + `secret.yaml.example` placeholder. Sealed Secrets adoption Faz 5 task'ında.
- ~~**2026-04-25:** PR-1 force-push gerekti.~~ **TAMAM:** PR-1 rebase + merge tamamlandı (`cb87259`).
- **2026-04-25 (akşam):** BFG history purge sonrası tüm commit hash'leri değişti. Win local `git reset --hard origin/main` ile sync edildi. Gelecekte yeni history purge olursa benzer sync gerekir.
