# IronStock Deployment Kılavuzu

## Gereksinimler

| Bileşen | Minimum Versiyon | Notlar |
|---------|-----------------|--------|
| PostgreSQL | 15+ | pg_trgm, pg_stat_statements extension'ları |
| Go | 1.23+ | Backend derlemesi için |
| Node.js | 20+ | Frontend build |
| Redis | 7+ | Opsiyonel — yatay ölçek için |
| MinIO / S3 | — | Opsiyonel — dosya ekleri için |
| HashiCorp Vault | 1.15+ | Opsiyonel — external secret backend |

## Ortam Değişkenleri

### Zorunlu

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `ENVANTER_DB_URL` | PostgreSQL bağlantı dizesi | `postgres://user:pass@localhost:5432/ironstock?sslmode=require` |
| `ENVANTER_MASTER_KEY` | 32-byte AES master key (base64) | `openssl rand -base64 32` ile üretilir |
| `ENVANTER_JWT_SECRET` | JWT imza anahtarı (≥32 byte) | `openssl rand -hex 32` |

### Opsiyonel

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ENVANTER_ADDR` | `:8080` | HTTP dinleme adresi |
| `ENVANTER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `ENVANTER_LOG_FORMAT` | `json` | `json` veya `text` |
| `ENVANTER_DB_MAX_CONNS` | `10` | Maksimum DB bağlantı havuzu |
| `ENVANTER_DB_MIN_CONNS` | `2` | Minimum DB bağlantı havuzu |
| `ENVANTER_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown süresi |
| `ENVANTER_BOOTSTRAP_ENABLED` | `false` | İlk kurulum bootstrap modu |
| `ENVANTER_DEFAULT_ADMIN_PASSWORD` | (rastgele) | İlk admin şifresi |
| `ENVANTER_WS_ALLOWED_ORIGINS` | `localhost:*` | WebSocket CORS origin'leri (virgülle ayrılmış) |
| `ENVANTER_PPROF_ENABLED` | `false` | pprof debug endpoint'leri (`/debug/pprof/`) |

### Redis (Yatay Ölçek)

| Değişken | Açıklama |
|----------|----------|
| `ENVANTER_REDIS_URL` | `redis://redis:6379/0` |
| `ENVANTER_REDIS_PASSWORD` | Redis auth şifresi |
| `ENVANTER_RATE_LIMIT_BACKEND` | `memory` veya `redis` |

### MinIO / S3 (Dosya Ekleri)

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ENVANTER_MINIO_ENDPOINT` | `minio:9000` | S3-uyumlu endpoint |
| `ENVANTER_MINIO_ACCESS_KEY` | — | Access key |
| `ENVANTER_MINIO_SECRET_KEY` | — | Secret key |
| `ENVANTER_MINIO_USE_SSL` | `false` | TLS kullanımı |
| `ENVANTER_MINIO_BUCKET` | `envanter` | Bucket adı |

### SMTP (E-posta Bildirimleri)

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ENVANTER_SMTP_HOST` | — | SMTP sunucu adresi |
| `ENVANTER_SMTP_PORT` | `587` | SMTP port |
| `ENVANTER_SMTP_USER` | — | SMTP kullanıcı |
| `ENVANTER_SMTP_PASSWORD` | — | SMTP şifre |
| `ENVANTER_SMTP_FROM` | `IronStock <noreply@localhost>` | Gönderen adresi |
| `ENVANTER_SMTP_TLS` | `starttls` | `none`, `starttls`, `tls` |
| `ENVANTER_APP_URL` | `http://localhost:5173` | Frontend URL (e-posta linkleri) |
| `ENVANTER_PASSWORD_RESET_TTL_MINUTES` | `60` | Şifre sıfırlama token süresi |

### WebAuthn / FIDO2

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ENVANTER_WEBAUTHN_RPID` | — | Relying Party ID (alan adı) |
| `ENVANTER_WEBAUTHN_RP_DISPLAY_NAME` | `IronStock` | Görüntülenen ad |
| `ENVANTER_WEBAUTHN_RP_ORIGINS` | `http://localhost:5173` | İzin verilen origin'ler |

### HashiCorp Vault

| Değişken | Açıklama |
|----------|----------|
| `ENVANTER_VAULT_ADDR` | `https://vault.cluster.local:8200` |
| `ENVANTER_VAULT_ROLE_ID` | AppRole role_id |
| `ENVANTER_VAULT_SECRET_ID` | AppRole secret_id |
| `ENVANTER_VAULT_NAMESPACE` | Enterprise namespace (opsiyonel) |

### LLM / AI Öneriler

| Değişken | Açıklama |
|----------|----------|
| `ENVANTER_LLM_PROVIDER` | `anthropic` veya `openai` |
| `ENVANTER_LLM_API_KEY` | API anahtarı |
| `ENVANTER_LLM_BASE_URL` | Override endpoint (Ollama: `http://localhost:11434/v1`) |
| `ENVANTER_LLM_MODEL` | Model adı |

## Kubernetes Deployment

### Ön Koşullar

```bash
# Secret oluştur
kubectl create secret generic ironstock-secret \
  --from-literal=ENVANTER_DB_URL='postgres://...' \
  --from-literal=ENVANTER_MASTER_KEY="$(openssl rand -base64 32)" \
  --from-literal=ENVANTER_JWT_SECRET="$(openssl rand -hex 32)"
```

### Deployment YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ironstock-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ironstock-api
  template:
    metadata:
      labels:
        app: ironstock-api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: api
          image: ironstock/api:latest
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: ironstock-secret
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: "1"
              memory: 512Mi
```

### PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ironstock-api-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ironstock-api
```

### NetworkPolicy (/metrics + /debug/pprof koruma)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ironstock-internal-only
spec:
  podSelector:
    matchLabels:
      app: ironstock-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - port: 8080
```

## Docker Compose (Geliştirme)

```bash
cd deploy/compose
docker compose up -d
```

## Migration

Sunucu ilk başlatıldığında migration'ları otomatik uygular. Manuel çalıştırma:

```bash
# Sıralı migration dosyaları
ls server/migrations/

# PostgreSQL'e doğrudan uygulama
for f in server/migrations/000*.sql; do
  psql "$ENVANTER_DB_URL" -f "$f"
done
```

## İlk Kurulum Adımları

1. PostgreSQL + extension'ları hazırla
2. Ortam değişkenlerini ayarla (en az DB_URL, MASTER_KEY, JWT_SECRET)
3. Sunucuyu başlat — ilk admin otomatik oluşturulur
4. Konsol çıktısındaki admin şifresini not et
5. `http://localhost:8080` adresinden giriş yap
6. Admin şifresini değiştir (zorunlu)
7. TOTP kurulumunu tamamla
8. Diğer kullanıcıları oluştur

## Sağlık Kontrolleri

| Endpoint | Amaç |
|----------|-------|
| `GET /healthz` | Liveness — sunucu çalışıyor mu |
| `GET /readyz` | Readiness — DB bağlantısı hazır mı |
| `GET /metrics` | Prometheus metrikleri |
