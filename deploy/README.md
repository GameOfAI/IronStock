# Deploy

Kubernetes manifests (Kustomize) ve Docker Compose (yerel geliştirme).

---

## Yerel Geliştirme — Docker Compose

```bash
# Tüm servisler (Postgres + MinIO + Adminer + Mailhog)
make up

# Durumu gör
docker compose -f deploy/compose/docker-compose.yml ps

# Durdur (volume'ları koru)
make down

# Volume dahil tamamen sıfırla
docker compose -f deploy/compose/docker-compose.yml down -v
```

| Servis | Port | Amaç |
|--------|------|------|
| PostgreSQL 16 | `5432` | Ana veritabanı |
| MinIO | `9000` (API) / `9001` (console) | S3-compatible nesne depolama |
| Adminer | `8081` | Veritabanı web arayüzü |
| Mailhog | `8025` (UI) / `1025` (SMTP) | Geliştirme e-posta yakalama |

---

## Kubernetes — Ağ Topolojisi

```mermaid
flowchart TD
    Internet(["İnternet"]) --> LB["LoadBalancer\nk8s Service"]
    LB --> Ingress["Nginx Ingress\nTLS termination"]

    Ingress -->|"/api/*"| API_SVC["Service: envanter-api\nClusterIP :8080"]
    Ingress -->|"/*"| WEB_SVC["Service: envanter-web\nClusterIP :80"]

    API_SVC --> API_POD["Pod: envanter-api\nGo server"]
    WEB_SVC --> WEB_POD["Pod: envanter-web\nnginx + React build"]

    API_POD -->|"pgx :5432"| PG_SVC["Service: postgres\nHeadless"]
    API_POD -->|"minio-go :9000"| MN_SVC["Service: minio\nHeadless"]

    PG_SVC --> PG_POD["StatefulSet: postgres\n20Gi PVC"]
    MN_SVC --> MN_POD["StatefulSet: minio\n10Gi PVC"]

    subgraph np["NetworkPolicy"]
        note["Sadece envanter-api\npostgres ve minio'ya erişebilir"]
    end
```

---

## CI/CD → Production Akışı

```mermaid
flowchart TD
    Dev["Developer\ngit push / PR aç"] --> GHA

    subgraph GHA["GitHub Actions CI"]
        S["Server\ngofmt + lint\nbuild + test"]
        W["Web\ntsc + ESLint\nVitest + build"]
        C["Client\ntsc + ESLint\nVitest"]
        IT["Integration\ntestcontainers\n+ Postgres"]
    end

    S & W & C & IT -->|"tüm job'lar yeşil"| Merge["PR merge → main"]

    Merge --> Docker["Docker Build & Push\nghcr.io/gameofai/envanter-*\n:main-{sha}"]
    Docker --> KustEdit["kustomize edit\nimage tag güncelle\nkustomization.yaml commit"]
    KustEdit --> ArgoCD["ArgoCD\nGitOps sync"]
    ArgoCD --> K8s["Kubernetes\nRolling update"]

    Tag["git tag v1.x.x\ngit push --tags"] --> Docker
    Tag --> TauriWin["Tauri Build\nWindows NSIS .msi"]
    Tag --> TauriMac["Tauri Build\nmacOS Universal .dmg"]
    TauriWin & TauriMac --> Release["GitHub Release\notomatik release notes\n+ artifact upload"]
```

---

## Kubernetes Manifest Dosyaları

| Dosya | İçerik |
|-------|--------|
| `namespace.yaml` | `envanter` namespace |
| `configmap.yaml` | Env değişkenleri (port, host'lar, feature flag'ler) |
| `postgres.yaml` | StatefulSet + headless Service + 20Gi PVC |
| `minio.yaml` | StatefulSet + headless Service + 10Gi PVC |
| `api.yaml` | Deployment + Service + HPA (2–10 replica) |
| `web.yaml` | Deployment + Service (nginx) |
| `adminer.yaml` | Tek replica Deployment + Service |
| `mailhog.yaml` | Tek replica Deployment + Service |
| `ingress.yaml` | Nginx Ingress + TLS termination |
| `network-policy.yaml` | Pod arası erişim kısıtlamaları |
| `servicemonitor.yaml` | Prometheus ServiceMonitor (kube-prometheus-stack) |
| `kustomization.yaml` | Kustomize overlay — image tag yönetimi |
| `secret.yaml.example` | Secret şablonu (commit edilmez) |
| `secret.sealed.yaml` | Kubeseal ile şifrelenmiş secret (repo'da güvenli) |
| `argocd-app.yaml` | ArgoCD Application tanımı |

---

## Secret Yönetimi (Sealed Secrets)

```mermaid
flowchart LR
    Tmpl["secret.yaml.example\nşablon"] -->|"cp + doldur"| Plain["secret.yaml\nplaintext"]
    Plain -->|"make seal-secret\nkubeseal"| Sealed["secret.sealed.yaml\nşifreli"]
    Sealed -->|"git commit"| Repo["GitHub Repo\nguvenli"]
    Repo -->|"ArgoCD sync"| K8s["k8s Secret\n(cluster içinde çözülür)"]

    PubCert["pub-cert.pem\ncluster public key"] --> kubeseal
    subgraph kubeseal["kubeseal"]
        enc["RSA-OAEP şifreleme"]
    end
    Plain --> kubeseal --> Sealed
```

```bash
# 1. Şablondan secret.yaml oluştur
cp deploy/k8s/secret.yaml.example deploy/k8s/secret.yaml

# 2. Değerleri doldur
ENVANTER_MASTER_KEY=$(openssl rand -base64 32)
ENVANTER_JWT_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
# ... secret.yaml içinde değerleri güncelle

# 3. Kubeseal ile şifrele
make seal-secret          # → deploy/k8s/secret.sealed.yaml

# 4. Şifreli dosyayı commit'le (güvenli)
git add deploy/k8s/secret.sealed.yaml
git commit -m "chore(deploy): update sealed secret"
```

| Secret Key | Açıklama |
|-----------|---------|
| `ENVANTER_MASTER_KEY` | Server-side envelope şifreleme master key (32B, base64) |
| `ENVANTER_JWT_SECRET` | JWT token imzalama (32B, base64) |
| `POSTGRES_PASSWORD` | PostgreSQL şifresi |
| `ENVANTER_DB_URL` | Full PostgreSQL bağlantı string'i |
| `MINIO_ROOT_USER` | MinIO root kullanıcı adı |
| `MINIO_ROOT_PASSWORD` | MinIO root şifresi |
| `ENVANTER_MINIO_ACCESS_KEY` | API erişim anahtarı |
| `ENVANTER_MINIO_SECRET_KEY` | API gizli anahtar |

Detay: `docs/ops/sealed-secrets.md`

---

## ArgoCD

```bash
# Manuel sync (otomatik sync açıksa gerekli değil)
argocd app sync envanter

# Durum
argocd app get envanter
```

`deploy/k8s/argocd-app.yaml` içinde sync politikası ve health check kriterleri tanımlıdır.

---

## Prometheus Metrikleri

`servicemonitor.yaml` Prometheus Operator'a `/metrics` endpoint'ini bildirir.
`kustomization.yaml` içinde varsayılan olarak yorum satırında — kube-prometheus-stack kuruluysa açılır:

```yaml
# kustomization.yaml
resources:
  # - servicemonitor.yaml  # uncomment when prometheus-operator installed
```
