# 0008 — Containerization & Deployment Stack

- **Durum:** Accepted (initial implementation; revize edilecek)
- **Tarih:** 2026-04-25
- **Karar veren:** Burak Haşlaman + paralel Claude session (Mac M4)
- **Değiştirir:** [ADR-0001](0001-tech-stack.md) deploy satırı (Helm → raw k8s + ArgoCD)

## Bağlam

Erken aşamada uçtan-uca **test edilebilir bir deploy baseline'ı** istendi. Mac M4 üzerinde lokal k8s test (kind/k3d/Docker Desktop k8s) hedeflendi. ADR-0001'de Helm chart önerilmişti; ekibin Helm öğrenme yükü olmadan hızlıca deploy edebilmesi için raw k8s YAML + ArgoCD GitOps tercih edildi.

Bu ADR, paralel iş bölümünde (ana kod Win, deploy Mac) yapılan kararları **geriye dönük dokümante eder**.

## Karar

### 1. Container Images (Multi-Stage Builds)

**`server/Dockerfile`** — Go statik binary:
```
FROM golang:1.22-alpine AS builder      # build aşaması
↓ go mod download + go build (CGO disabled)
FROM scratch                             # runtime
COPY /envanter-api → /
ENTRYPOINT ["/envanter-api"]
```
- `scratch` base → ~20MB image, ekstra attack surface yok
- Static binary; libc dependency yok
- ⚠️ scratch'te shell yok → debug için `kubectl exec` ile inceleme yapılamaz; production'da `distroless/static-debian12` düşünülmeli

**`web/Dockerfile`** — Vite build + nginx serve:
```
FROM node:20-alpine AS builder           # npm install + build
FROM nginx:alpine                        # runtime
COPY dist → /usr/share/nginx/html
COPY nginx.conf → /etc/nginx/conf.d/default.conf
```
- `nginx.conf`:
  - `/api/` → `envanter-api:8080` proxy
  - `/ws` → WebSocket upgrade proxy
  - `/` → SPA fallback (`try_files $uri /index.html`)

### 2. Container Registry: GHCR

- `ghcr.io/bhaslaman/envanter-api:latest`
- `ghcr.io/bhaslaman/envanter-web:latest`
- **Multi-arch:** `linux/amd64` + `linux/arm64` (M4 Mac yerel pull için)
- **Auth:** Cluster'a `ghcr-pull-secret` (`docker-registry` type) eklenir; api+web Deployment'larında `imagePullSecrets`
- **Cache:** GitHub Actions cache (`type=gha,mode=max`) — build süresini düşürür

### 3. CI Pipeline (.github/workflows/ci.yml)

Yeni `docker` job:
```yaml
docker:
  needs: [server]                                # önce Go test/lint yeşil olmalı
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  permissions: { contents: read, packages: write }
  steps:
    - docker/login-action (ghcr.io, GITHUB_TOKEN)
    - docker/setup-buildx-action
    - docker/build-push-action × 2 (api + web, multi-platform)
```

PR'larda Docker build edilmiyor — sadece main'e push'larda. Pipeline süresini düşürür ve registry kirlenmez.

### 4. K8s Manifests (Raw YAML)

`deploy/k8s/` altında 9 dosya:

| Dosya | Resource | Not |
|-------|----------|-----|
| `namespace.yaml` | Namespace `envanter` | tüm resource'lar burada |
| `configmap.yaml` | ConfigMap `envanter-config` | non-secret env (ADDR, LOG_LEVEL, DB_URL host, SMTP) |
| `secret.yaml` | Secret `envanter-secret` | ENVANTER_MASTER_KEY, ENVANTER_JWT_SECRET, POSTGRES_PASSWORD |
| `postgres.yaml` | StatefulSet + PVC (2Gi) + Service | dev/test için inline DB |
| `api.yaml` | Deployment + Service | livenessProbe + readinessProbe → /healthz |
| `web.yaml` | Deployment + Service (NodePort 30830) | sadece dev erişimi için NodePort |
| `adminer.yaml` | Deployment + Service | DB admin UI (dev) |
| `mailhog.yaml` | Deployment + Service | mail capture (dev) |
| `argocd-app.yaml` | ArgoCD Application (`infra` namespace) | GitOps deployment |

### 5. GitOps: ArgoCD Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
spec:
  source:
    repoURL: https://github.com/bhaslaman/Envanter_App.git
    targetRevision: main
    path: deploy/k8s
  destination:
    namespace: envanter
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
```

**Workflow:** `git push origin main` → CI build & push images → ArgoCD detect (polling) → namespace'i sync. Tam GitOps.

## Alternatifler

### Helm chart (orijinal ADR-0001 tercihi)
- **Artıları:** Templating + values.yaml ile env-bazlı override. Stable, olgun.
- **Reddedildi (şimdilik):** Raw YAML ile başlamak hızlı + öğrenme yükü minimal. İleride Helm'e migrate kolay (hatta ArgoCD Helm chart kaynağını da destekler).

### Kustomize
- **Artıları:** Raw YAML üstüne overlay (base + dev/stage/prod). Helm kadar templating yok ama daha basit.
- **Reddedildi (şimdilik):** Tek environment için karmaşıklık eklemiyor. Multi-env ihtiyacı çıkınca düşünülür.

### FluxCD (ArgoCD yerine)
- **Reddedildi:** ArgoCD UI'sı + CLI'sı daha kullanıcı dostu, popülasyonu daha geniş.

## ⚠️ Bilinen Kritik Eksiklikler

### 1. Plaintext Secret'lar Repo'da

`deploy/k8s/secret.yaml` içinde **gerçek görünüşlü** secret değerler commit edildi:
```yaml
ENVANTER_MASTER_KEY: "+uz8/VdTGyS7uZtCRIYPom5DPEIjSDa0o4F7/1lwo/w="
ENVANTER_JWT_SECRET: "ea1Ns+uhMy5Voz0omlTt0tvoigveTPyIQcr1XFjeY+s="
POSTGRES_PASSWORD: "envanter_dev"
```

**Bu sektör pratiği ihlali.** Repo private olsa bile:
- Git history bunları kalıcı tutar
- Read-erişimi olan herkes görür
- Repo public olursa anında leak

**Acil aksiyonlar (KRİTİK TODO):**
- [ ] `ENVANTER_MASTER_KEY` rotate (yeni rastgele 32B üret)
- [ ] `ENVANTER_JWT_SECRET` rotate
- [ ] `secret.yaml`'ı `.gitignore`'a ekle
- [ ] `secret.yaml.example` placeholder ile yer tutucu commit
- [ ] Git history'den eski secret'ları temizle (`git filter-repo` veya BFG)
- [ ] Sealed Secrets / External Secrets Operator / SOPS adoption (Faz 5)

### 2. Diğer Production-Readiness Eksikleri

- `:latest` tag — anti-pattern. Git SHA veya semver (`:v0.1.0`) kullanılmalı. Reproducible deploy yok.
- **Resource limits yok** — CPU/memory `requests`/`limits` belirtilmemiş; pod scheduling ve OOM koruması zayıf.
- **HorizontalPodAutoscaler yok** — load arttıkça scale-out yok.
- **DB migration init container yok** — deploy edildiğinde `goose up` otomatik koşmalı, yoksa schema değişikliği el ile yapılır.
- **Ingress + TLS yok** — NodePort sadece dev pattern. Prod'da Ingress + cert-manager + Let's Encrypt gerekli.
- **Single replica** — HA yok.
- **Postgres on PVC** — dev için OK, prod'da managed DB (Cloud SQL / RDS / on-prem HA cluster) düşünülmeli.
- **Pod Security Standards yok** — `securityContext` (runAsNonRoot, readOnlyRootFilesystem, drop capabilities) eksik.
- **NetworkPolicy yok** — pod-to-pod traffic kısıtlanmamış.

## Sonuçlar

### Olumlu
- ✅ Hızlı testable deploy baseline — Mac M4 üzerinde uçtan uca çalışıyor
- ✅ ArgoCD GitOps — main'e push = otomatik sync
- ✅ Multi-arch build → Mac developer ergonomy iyi
- ✅ Container size küçük (server scratch ~20MB)

### Olumsuz / Risk
- ⚠️ **Secret yönetimi production-ready değil** — acil iyileştirme şart
- ⚠️ Reproducibility eksik (`:latest` tag, no version pinning)
- ⚠️ Operability eksik (no resource limits, no HPA, no NetworkPolicy, no PSS)
- ⚠️ Faz 5 (production hardening) iş yükü genişledi

### Nötr
- Helm migration ileride yapılabilir; ArgoCD Helm kaynağını destekler
- Kustomize overlay'leri eklemek de geri dönüşsüz değil

## Faz Sorumlulukları

| Faz | İş |
|-----|-----|
| **ŞİMDİ (kritik)** | Secret rotation + `.gitignore` + git history temizliği + `secret.yaml.example` |
| **Faz 2** | DB migration init container ekleme (api Deployment'ına initContainers) |
| **Faz 5** | Sealed Secrets / External Secrets Operator adoption |
| **Faz 5** | Image versioning (`:v0.1.0` git SHA + semver), `:latest` retire |
| **Faz 5** | Resource limits + HPA + PodDisruptionBudget |
| **Faz 5** | Ingress + cert-manager + TLS |
| **Faz 5** | Pod Security Standards + NetworkPolicy |
| **Faz 5** | Helm chart migration (opsiyonel, gerekirse) |
| **Faz 5** | Managed DB değerlendirmesi (Cloud SQL / RDS / on-prem HA) |

## Referanslar

- ArgoCD docs: https://argo-cd.readthedocs.io/
- GHCR docs: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- docker/build-push-action: https://github.com/docker/build-push-action
- distroless images: https://github.com/GoogleContainerTools/distroless
