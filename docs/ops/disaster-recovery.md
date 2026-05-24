# IronStock Disaster Recovery Runbook

## Quarterly Restore Drill

Her çeyrekte bir geri yükleme tatbikatı yapılmalıdır. Bu döküman tatbikat adımlarını tanımlar.

### Hazırlık

1. İzole bir ortam hazırlayın (staging cluster veya lokal Docker Compose)
2. En son production yedekini indirin
3. Master key'in yedeğini doğrulayın

### Tatbikat Adımları

#### Adım 1: Ortam Kurulumu (5 dk)

```bash
# Docker Compose ile izole ortam
cd deploy/compose
docker compose -f docker-compose.drill.yml up -d postgres minio
```

#### Adım 2: Geri Yükleme (10 dk)

```bash
export ENVANTER_DB_URL="postgres://ironstock:drill@localhost:5433/ironstock"
./scripts/restore.sh /path/to/latest-backup.tar.gz
```

#### Adım 3: API Başlatma (5 dk)

```bash
export ENVANTER_MASTER_KEY="<production-master-key>"
export ENVANTER_JWT_SECRET="$(openssl rand -hex 32)"  # drill için yeni
docker compose -f docker-compose.drill.yml up -d api
```

#### Adım 4: Doğrulama (15 dk)

| Kontrol | Komut | Beklenen |
|---------|-------|----------|
| Readiness | `curl localhost:8080/readyz` | `{"status":"ok"}` |
| Admin login | POST /auth/login | 200 + access_token |
| Item listesi | GET /items | Item'lar mevcut |
| Field çözme | GET /items/{id} (web UI) | Şifreli alanlar görünür |
| Audit log | GET /admin/audit-log | Geçmiş kayıtlar mevcut |
| WS bağlantı | wscat -c ws://localhost:8080/api/v1/ws | 101 Upgrade |

#### Adım 5: Temizlik (5 dk)

```bash
docker compose -f docker-compose.drill.yml down -v
```

### Tatbikat Raporu

Her tatbikat sonrası doldurun:

```markdown
## Restore Drill Raporu — YYYY-QN

- Tarih: YYYY-MM-DD
- Katılımcılar: ...
- Yedek tarihi: YYYY-MM-DD HH:MM UTC
- Yedek boyutu: X GB

### Sonuçlar

| Metrik | Hedef | Gerçekleşen |
|--------|--------|-------------|
| Toplam süre | < 30 dk | ... dk |
| DB restore | < 10 dk | ... dk |
| Doğrulama | < 15 dk | ... dk |

### Sorunlar

- [ ] ...

### Aksiyonlar

- [ ] ...
```

## Escrow Prosedürü

### Master Key Escrow

Master key'in güvenli kopyası çevrimdışı saklanmalıdır:

1. **Oluşturma:**
   ```bash
   echo $ENVANTER_MASTER_KEY | qrencode -o master-key-qr.png
   ```

2. **Yazdırma:** QR kodu kağıda yazdırın (2 kopya)

3. **Saklama:**
   - Kopya 1: Şirket kasası
   - Kopya 2: Farklı lokasyonda banka kasası

4. **Erişim:** En az 2 yetkili kişinin onayı gerekli

### JWT Secret Escrow

JWT secret kaybedilirse tüm mevcut oturumlar geçersiz olur (kullanıcılar yeniden giriş yapar). Kritik değil ama yedeklenmesi önerilir.

## İletişim Planı

| Durum | Bilgilendirme | Kanal |
|-------|--------------|-------|
| Planlı bakım | 24 saat önceden | E-posta + Slack |
| Planlanmamış kesinti | Hemen | Slack #ops + SMS |
| Veri kaybı şüphesi | Hemen | Yönetim + güvenlik ekibi |
| Master key ihlali | Hemen | CISO + tüm kullanıcılar |

## RTO / RPO Tablosu

| Bileşen | RPO | RTO | Strateji |
|---------|-----|-----|----------|
| PostgreSQL | 24 saat | 15 dk | Günlük pg_dump + CronJob |
| PostgreSQL (üretim) | 5 dk | 10 dk | WAL archiving + streaming replica |
| MinIO | 24 saat | 20 dk | Günlük mc mirror |
| Master Key | ∞ (kayıpsız) | 5 dk | Çevrimdışı escrow |
| Tüm sistem | 24 saat | 30 dk | Tam yedek + restore script |
