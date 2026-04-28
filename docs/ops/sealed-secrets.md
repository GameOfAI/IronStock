# Sealed Secrets Kurulum ve Kullanım Kılavuzu

Sealed Secrets, Kubernetes secret'larını şifreleyerek git'e commit etmeyi güvenli hale getirir.
Controller, cluster'da çalışır ve yalnızca o cluster SealedSecret'ı çözebilir.

## Bileşenler

| Bileşen | Açıklama |
|---------|----------|
| `sealed-secrets-controller` | k8s içinde çalışır, SealedSecret CRD'yi izler ve Secret oluşturur |
| `kubeseal` | CLI — Secret'ı controller'ın public key'i ile şifreler |
| `pub-cert.pem` | Controller'ın public key'i — git'e commit edilir (güvenli) |
| `secret.sealed.yaml` | Şifrelenmiş secret manifest — git'e commit edilir (güvenli) |
| `secret.yaml` | Plaintext secret — **asla git'e commit edilmez** (`.gitignore`'da) |

## 1. Controller Kurulumu (tek seferlik, cluster başına)

```bash
# Bitnami Sealed Secrets controller kur (v0.26.0 — en son için release sayfasına bak)
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.26.0/controller.yaml

# Controller'ın ayağa kalkmasını bekle
kubectl -n kube-system wait --for=condition=Available deploy/sealed-secrets-controller --timeout=60s
```

Controller yalnızca bir kez kurulur. Farklı ortam (prod/stage) için farklı cluster = farklı key.

## 2. kubeseal CLI Kurulumu

```bash
# macOS
brew install kubeseal

# Linux (amd64)
curl -sL https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.26.0/kubeseal-0.26.0-linux-amd64.tar.gz \
  | tar xz -C /usr/local/bin kubeseal

# Windows (PowerShell, winget)
winget install bitnami.kubeseal
```

## 3. Public Key'i Çek (yeni cluster sonrası tekrarla)

Controller'ın public key'i şifreleme için kullanılır. Public key olduğu için git'e commit etmek güvenlidir.

```bash
# Repo kökünden çalıştır
make sealed-secrets-fetch-cert

# Veya elle:
kubeseal --fetch-cert \
  --controller-name=sealed-secrets-controller \
  --controller-namespace=kube-system \
  > deploy/k8s/pub-cert.pem

git add deploy/k8s/pub-cert.pem
git commit -m "chore(deploy): update Sealed Secrets public cert"
```

> **Not:** Cluster'ı sıfırlarsanız ya da controller'ı yeniden kurarsanız public key değişir.
> Bu durumda tüm sealed secret'ları yeni key ile tekrar seal etmeniz gerekir.

## 4. Secret'ı Seal Et

Önce plaintext `deploy/k8s/secret.yaml` dosyasını oluştur (`secret.yaml.example`'dan kopyala):

```bash
cp deploy/k8s/secret.yaml.example deploy/k8s/secret.yaml
# secret.yaml içindeki placeholder değerleri gerçek değerlerle doldur
# openssl rand -base64 32   →  ENVANTER_MASTER_KEY ve ENVANTER_JWT_SECRET için
# openssl rand -base64 24   →  POSTGRES_PASSWORD için
```

Sonra seal et:

```bash
make seal-secret

# Veya elle:
kubeseal \
  --cert deploy/k8s/pub-cert.pem \
  --format yaml \
  < deploy/k8s/secret.yaml \
  > deploy/k8s/secret.sealed.yaml

git add deploy/k8s/secret.sealed.yaml
git commit -m "chore(deploy): update sealed secret"
```

> **Önemli:** `secret.yaml` dosyasını commit ETME — `.gitignore`'da tanımlı.

## 5. kustomization.yaml'a Ekle (ilk seal sonrası, tek seferlik)

`deploy/k8s/kustomization.yaml` içinde comment'i kaldır:

```yaml
resources:
  - namespace.yaml
  - configmap.yaml
  - secret.sealed.yaml   # bu satırı uncomment et
  - postgres.yaml
  ...
```

Commit et:

```bash
git add deploy/k8s/kustomization.yaml
git commit -m "feat(deploy): enable SealedSecret in kustomization"
```

ArgoCD otomatik sync edecek ve `SealedSecret` → `Secret` dönüşümü cluster'da gerçekleşecek.

## 6. Secret Rotation

Bir veya birden fazla secret'ı döndürmek için:

```bash
# secret.yaml'da ilgili değeri güncelle, yeniden seal et
make seal-secret
git add deploy/k8s/secret.sealed.yaml
git commit -m "chore(deploy): rotate ENVANTER_MASTER_KEY"
git push
# ArgoCD otomatik sync → controller Secret'ı günceller
```

## 7. Acil Durum (Controller Key Kaybı)

Controller private key'i kaybolursa SealedSecret'lar çözülemez. Yedek almak için:

```bash
# Controller private key'ini yedekle (güvenli yerde sakla — ASLA git'e commit etme)
kubectl -n kube-system get secret \
  -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o yaml > sealed-secrets-master-key-BACKUP-$(date +%Y%m%d).yaml
```

## Makefile Referansı

```
make sealed-secrets-install    Sealed Secrets controller'ı cluster'a kur
make sealed-secrets-fetch-cert  Controller'ın public cert'ini çek → pub-cert.pem
make seal-secret               secret.yaml → secret.sealed.yaml (pub-cert.pem ile)
```
