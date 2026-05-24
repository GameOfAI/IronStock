# IronStock API Referansı

Base URL: `http://localhost:8080`

Kimlik doğrulama: `Authorization: Bearer <access_token>` (aksi belirtilmediği sürece)

## Kimlik Doğrulama

### `POST /api/v1/auth/login`
Kullanıcı girişi. TOTP gerekiyorsa `totp_required: true` döner.

### `POST /api/v1/auth/login/totp`
TOTP doğrulama (2. adım).

### `POST /api/v1/auth/register`
Yeni kullanıcı kaydı (admin tarafından).

### `POST /api/v1/auth/refresh`
Access token yenileme (refresh token ile).

### `POST /api/v1/auth/logout`
Mevcut oturumu sonlandırma.

### `POST /api/v1/auth/logout-all`
Tüm oturumları sonlandırma.

### `POST /api/v1/auth/change-password`
Şifre değiştirme.

### `POST /api/v1/auth/keypair-init`
E2E şifreleme keypair'i başlatma.

### `POST /api/v1/auth/forgot-password`
Şifre sıfırlama e-postası gönderme.

### `POST /api/v1/auth/reset-password`
Şifre sıfırlama (token ile).

### TOTP Yönetimi
- `POST /api/v1/auth/totp/init` — TOTP kurulumu başlatma (QR kodu)
- `GET /api/v1/auth/totp/status` — TOTP durumu
- `DELETE /api/v1/auth/totp` — TOTP devre dışı bırakma

### WebAuthn / FIDO2
- `POST /api/v1/auth/webauthn/register/begin` — Kayıt başlatma
- `POST /api/v1/auth/webauthn/register/finish` — Kayıt tamamlama
- `POST /api/v1/auth/webauthn/login/begin` — Giriş başlatma
- `POST /api/v1/auth/webauthn/login/finish` — Giriş tamamlama

### Hesap Kurtarma
- `POST /api/v1/auth/recover/complete` — Kurtarma kodu ile giriş

### SSO
- `POST /api/v1/auth/sso/{provider_id}/login` — SSO giriş başlatma
- `GET /api/v1/auth/sso/{provider_id}/callback` — OIDC callback

### Bootstrap
- `POST /api/v1/auth/bootstrap` — Acil bootstrap girişi (ENVANTER_BOOTSTRAP_ENABLED=true)
- `GET /api/v1/auth/bootstrap/status` — Bootstrap durumu

## Klasörler

Auth: `Bearer token` gerekli.

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/folders` | Klasör listesi |
| `POST` | `/api/v1/folders` | Klasör oluşturma |
| `GET` | `/api/v1/folders/{id}` | Klasör detayı |
| `PUT` | `/api/v1/folders/{id}` | Klasör güncelleme |
| `DELETE` | `/api/v1/folders/{id}` | Klasör silme |
| `POST` | `/api/v1/folders/{id}/permissions` | İzin verme |
| `DELETE` | `/api/v1/folders/{id}/permissions/{user_id}` | İzin alma |

## Item'lar

Auth: `Bearer token` gerekli.

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items` | Item listesi |
| `GET` | `/api/v1/items/search?q=&fuzzy=` | Arama (substring veya trigram) |
| `GET` | `/api/v1/items/duplicates?name=` | Duplikat ad kontrolü |
| `GET` | `/api/v1/items/health-report` | Sağlık raporu (admin) |
| `POST` | `/api/v1/items` | Item oluşturma |
| `GET` | `/api/v1/items/{id}` | Item detayı |
| `PUT` | `/api/v1/items/{id}` | Item güncelleme |
| `DELETE` | `/api/v1/items/{id}` | Item silme |

### Paylaşım

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/shares` | Paylaşım listesi |
| `POST` | `/api/v1/items/{id}/shares` | Kullanıcı ile paylaşma |
| `DELETE` | `/api/v1/items/{id}/shares/{user_id}` | Paylaşımı kaldırma |
| `POST` | `/api/v1/items/{id}/group-shares` | Grup ile paylaşma |
| `DELETE` | `/api/v1/items/{id}/group-shares/{group_id}` | Grup paylaşımı kaldırma |

### Bağlantılar (Linked Items)

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/links` | Bağlantı listesi |
| `POST` | `/api/v1/items/{id}/links` | Bağlantı oluşturma (mirror/reference) |
| `DELETE` | `/api/v1/items/{id}/links/{link_id}` | Bağlantı silme |

### Etiketler

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/tags` | Item etiketleri |
| `POST` | `/api/v1/items/{id}/tags` | Etiket ekleme |
| `DELETE` | `/api/v1/items/{id}/tags/{tag_id}` | Etiket kaldırma |
| `GET` | `/api/v1/items/{id}/favorite` | Favori durumu |
| `POST` | `/api/v1/items/{id}/favorite` | Favoriye ekleme |
| `DELETE` | `/api/v1/items/{id}/favorite` | Favoriden çıkarma |

### Dosya Ekleri

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/attachments` | Ek listesi |
| `POST` | `/api/v1/items/{id}/attachments` | Yükleme başlatma |
| `POST` | `/api/v1/items/{id}/attachments/{att_id}/confirm` | Yükleme onaylama |
| `GET` | `/api/v1/items/{id}/attachments/{att_id}/url` | İndirme URL'si |
| `DELETE` | `/api/v1/items/{id}/attachments/{att_id}` | Ek silme |

### Diğer Item İşlemleri

| Method | Path | Açıklama |
|--------|------|----------|
| `POST` | `/api/v1/items/{id}/rotate` | Rotation kaydı |
| `GET` | `/api/v1/items/{id}/fields/{field_def_id}/versions` | Field versiyon geçmişi |
| `GET` | `/api/v1/items/{id}/health` | Sağlık skoru |

## Vault (Dinamik Secret'lar)

| Method | Path | Açıklama |
|--------|------|----------|
| `POST` | `/api/v1/items/{id}/vault-fetch` | Vault'tan secret çekme |
| `POST` | `/api/v1/items/{id}/dynamic-cred` | Dinamik credential üretme |
| `DELETE` | `/api/v1/items/{id}/dynamic-cred` | Lease iptal etme |

## K8s Proxy

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/k8s/pods` | Pod listesi |
| `GET` | `/api/v1/items/{id}/k8s/services` | Service listesi |
| `GET` | `/api/v1/items/{id}/k8s/deployments` | Deployment listesi |
| `GET` | `/api/v1/items/{id}/k8s/configmaps` | ConfigMap listesi |
| `GET` | `/api/v1/items/{id}/k8s/secrets` | Secret listesi (metadata only) |
| `GET` | `/api/v1/items/{id}/k8s/metrics` | Metrik listesi |

## Gruplar

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/groups` | Grup listesi |
| `POST` | `/api/v1/groups` | Grup oluşturma |
| `GET` | `/api/v1/groups/{id}` | Grup detayı |
| `DELETE` | `/api/v1/groups/{id}` | Grup silme |
| `GET` | `/api/v1/groups/{id}/members` | Üye listesi |
| `POST` | `/api/v1/groups/{id}/members` | Üye ekleme |
| `DELETE` | `/api/v1/groups/{id}/members/{user_id}` | Üye çıkarma |
| `POST` | `/api/v1/groups/{id}/folder-permissions` | Klasör izni verme |
| `DELETE` | `/api/v1/groups/{id}/folder-permissions/{folder_id}` | Klasör izni alma |

## Etiketler (Global)

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/tags` | Tüm etiketler |
| `POST` | `/api/v1/tags` | Etiket oluşturma |
| `DELETE` | `/api/v1/tags/{tag_id}` | Etiket silme |
| `GET` | `/api/v1/favorites` | Favori item'lar |

## Bildirimler

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/notifications` | Bildirim listesi |
| `GET` | `/api/v1/notifications/unread-count` | Okunmamış sayısı |
| `POST` | `/api/v1/notifications/read-all` | Tümünü okundu işaretle |
| `POST` | `/api/v1/notifications/{id}/read` | Tek bildirimi okundu işaretle |

### Bildirim Tercihleri

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/users/me/notification-prefs` | Tercihler |
| `PUT` | `/api/v1/users/me/notification-prefs` | Tercihleri güncelle |
| `GET` | `/api/v1/users/me/channels` | Dış kanallar (Slack, vb.) |
| `POST` | `/api/v1/users/me/channels` | Kanal ekleme |
| `DELETE` | `/api/v1/users/me/channels/{channel_id}` | Kanal silme |
| `POST` | `/api/v1/users/me/channels/{channel_id}/test` | Kanal testi |

## Paylaşım Linkleri

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/share-links` | Link listesi |
| `POST` | `/api/v1/share-links` | Link oluşturma |
| `DELETE` | `/api/v1/share-links/{id}` | Link silme |
| `GET` | `/api/v1/share-links/{token}/access` | Link ile erişim |

## Pipeline Diyagramları

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/pipelines` | Diyagram listesi |
| `POST` | `/api/v1/pipelines` | Diyagram oluşturma |
| `GET` | `/api/v1/pipelines/{id}` | Diyagram detayı |
| `PUT` | `/api/v1/pipelines/{id}` | Diyagram güncelleme |
| `DELETE` | `/api/v1/pipelines/{id}` | Diyagram silme |
| `POST` | `/api/v1/pipelines/{id}/nodes` | Düğüm ekleme |
| `DELETE` | `/api/v1/pipelines/{id}/nodes/{item_id}` | Düğüm kaldırma |
| `PUT` | `/api/v1/pipelines/{id}/layout` | Layout kaydetme |
| `GET` | `/api/v1/pipelines/{id}/graph` | Diyagram graph verisi |

## Dependency Graph

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/graph` | İlişki grafiği |

## Katalog

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/field-definitions` | Alan tanımları (30 seed field) |
| `GET` | `/api/v1/item-types` | Item tipleri |
| `GET` | `/api/v1/users/me/keypair` | Kendi keypair'im |
| `GET` | `/api/v1/users/{id}/public-key` | Kullanıcı public key |

## Lifecycle

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/items/{id}/lifecycle` | Lifecycle durumu |
| `POST` | `/api/v1/items/{id}/lifecycle` | Lifecycle güncelleme |

## Şablonlar

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/templates` | Şablon listesi |
| `POST` | `/api/v1/templates` | Şablon oluşturma |
| `GET` | `/api/v1/templates/{id}` | Şablon detayı |
| `PUT` | `/api/v1/templates/{id}` | Şablon güncelleme |
| `DELETE` | `/api/v1/templates/{id}` | Şablon silme |

## AI Öneriler

| Method | Path | Açıklama |
|--------|------|----------|
| `POST` | `/api/v1/items/{id}/suggest` | AI etiket/ilişki önerisi |

## Ansible

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/ansible/inventory` | Ansible dynamic inventory |

## API Token

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/api-tokens` | Token listesi |
| `POST` | `/api/v1/api-tokens` | Token oluşturma |
| `DELETE` | `/api/v1/api-tokens/{id}` | Token silme |

## Admin

Auth: Admin rolü gerekli.

### Kullanıcı Yönetimi

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/users` | Kullanıcı listesi (pagination) |
| `POST` | `/api/v1/admin/users` | Kullanıcı oluşturma |
| `POST` | `/api/v1/admin/users/{id}/disable` | Devre dışı bırakma |
| `POST` | `/api/v1/admin/users/{id}/enable` | Etkinleştirme |
| `POST` | `/api/v1/admin/users/{id}/roles` | Rol verme |
| `DELETE` | `/api/v1/admin/users/{id}/roles/{role_name}` | Rol alma |
| `POST` | `/api/v1/admin/users/{id}/totp/reset` | TOTP sıfırlama |
| `PATCH` | `/api/v1/admin/users/{id}/totp-required` | TOTP zorunluluğu |
| `PATCH` | `/api/v1/admin/users/{id}/webauthn-required` | WebAuthn zorunluluğu |
| `GET` | `/api/v1/admin/users/{id}/ip-restrictions` | IP kısıtlamaları |
| `PATCH` | `/api/v1/admin/users/{id}/ip-restrictions` | IP kısıtlama güncelleme |
| `POST` | `/api/v1/admin/users/{id}/break-glass` | Break-glass ayarı |

### Audit Log

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/audit-log` | Audit log sorgusu (6 filter, pagination) |

### Export

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/export` | JSON export |
| `POST` | `/api/v1/admin/export/encrypted` | Şifreli ZIP export |

### mTLS Sertifika Yönetimi

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/client-cert-cas` | CA listesi |
| `POST` | `/api/v1/admin/client-cert-cas` | CA yükleme |
| `DELETE` | `/api/v1/admin/client-cert-cas/{ca_id}` | CA silme |
| `GET` | `/api/v1/admin/users/{id}/client-certs` | Kullanıcı sertifikaları |
| `POST` | `/api/v1/admin/users/{id}/client-certs/issue` | Sertifika oluşturma |
| `POST` | `/api/v1/admin/users/{id}/client-certs/register` | Sertifika kaydetme |
| `DELETE` | `/api/v1/admin/users/{id}/client-certs/{cert_id}` | Sertifika iptali |
| `PATCH` | `/api/v1/admin/users/{id}/cert-required` | Sertifika zorunluluğu |

### Log Yönlendirme

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/log-forwarding` | Yapılandırma listesi |
| `POST` | `/api/v1/admin/log-forwarding` | Yapılandırma oluşturma |
| `PUT` | `/api/v1/admin/log-forwarding/{id}` | Yapılandırma güncelleme |
| `DELETE` | `/api/v1/admin/log-forwarding/{id}` | Yapılandırma silme |
| `POST` | `/api/v1/admin/log-forwarding/{id}/test` | Yapılandırma testi |

### SSO Sağlayıcı Yönetimi

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/sso/providers` | Sağlayıcı listesi |
| `POST` | `/api/v1/admin/sso/providers` | Sağlayıcı oluşturma |
| `PUT` | `/api/v1/admin/sso/providers/{id}` | Sağlayıcı güncelleme |
| `DELETE` | `/api/v1/admin/sso/providers/{id}` | Sağlayıcı silme |
| `POST` | `/api/v1/admin/sso/providers/{id}/test` | LDAP bağlantı testi |

### K8s Cluster Yönetimi

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/k8s/clusters` | Cluster listesi |
| `POST` | `/api/v1/admin/k8s/clusters` | Cluster ekleme |
| `PUT` | `/api/v1/admin/k8s/clusters/{id}` | Cluster güncelleme |
| `DELETE` | `/api/v1/admin/k8s/clusters/{id}` | Cluster silme |
| `POST` | `/api/v1/admin/k8s/clusters/{id}/test` | Bağlantı testi |

### Secret Scanning

| Method | Path | Açıklama |
|--------|------|----------|
| `PUT` | `/api/v1/items/{id}/scan` | Parmak izi kaydetme |
| `GET` | `/api/v1/items/{id}/scan` | Tarama yapılandırması |
| `DELETE` | `/api/v1/items/{id}/scan` | Parmak izi silme |
| `POST` | `/api/v1/security/scan` | Toplu parmak izi tarama |
| `GET` | `/api/v1/admin/scan/detections` | Tespit listesi |
| `POST` | `/api/v1/admin/scan/detections/{id}/ack` | Tespit onaylama |

### Raporlar

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/v1/admin/reports/inventory` | HTML envanter raporu |

## SCIM 2.0

Auth: Bearer token (SCIM scope).

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/scim/v2/Users` | Kullanıcı listesi |
| `POST` | `/scim/v2/Users` | Kullanıcı oluşturma |
| `GET` | `/scim/v2/Users/{id}` | Kullanıcı detayı |
| `DELETE` | `/scim/v2/Users/{id}` | Kullanıcı silme |
| `GET` | `/scim/v2/Groups` | Grup listesi |
| `POST` | `/scim/v2/Groups` | Grup oluşturma |
| `GET` | `/scim/v2/Groups/{id}` | Grup detayı |

## WebSocket

### Bağlantı Akışı

1. `POST /api/v1/ws/ticket` — Tek kullanımlık ticket al (JWT auth)
2. `GET /api/v1/ws?ticket={ticket}` — WebSocket bağlantısı aç

Subprotocol: `envanter.v1`

### Event Tipleri

- `item.created`, `item.updated`, `item.deleted`
- `folder.created`, `folder.updated`, `folder.deleted`
- `item.shared`, `item.unshared`
- `item.expiry_warning`

## Operasyon Endpoint'leri

| Method | Path | Auth | Açıklama |
|--------|------|------|----------|
| `GET` | `/healthz` | Yok | Liveness probe |
| `GET` | `/readyz` | Yok | Readiness probe (DB ping) |
| `GET` | `/metrics` | Yok (NetworkPolicy) | Prometheus metrikleri |
| `GET` | `/debug/pprof/*` | Yok (ENVANTER_PPROF_ENABLED) | CPU/memory profiling |
