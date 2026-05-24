# ADR-0012: Geliştirme Takip Disiplini

**Tarih:** 2026-05-24
**Durum:** Kabul Edildi
**Karar Vericiler:** Burak Haşlaman

---

## Bağlam

IronStock birden fazla geliştirici ve/veya AI asistan tarafından geliştirilmektedir. Yapılan incelemede, tamamlanan 22 PR'dan 10'unun (PR-SEC4, PR-SEC5, PR-SCALE, PR-LINK, PR-VAULT-DYN, PR-EXPORT, PR-SEARCH-FT, PR-TPL, PR-DUP, PR-HEALTH) `TODO.md`'de `[ ]` olarak kaldığı, `PROGRESS.md`'de eksik entry bulunduğu tespit edildi.

Bu durum:
- Projeye yeni katılan geliştiricilerin (veya yeni AI session'larının) yanlış proje durumu değerlendirmesi yapmasına yol açtı
- "Ne yapıldı, ne kaldı" sorusunun yanıtlanabilmesi için git log manuel incelemesi gerekti
- Planlama kararlarının sağlıklı veriye dayanmamasına neden oldu

## Karar

### 1. Tracking Dosyaları Kuralı (RULES.md'den formalize)

Her **kod değişikliği** içeren commit, aynı commit içinde şu dosyaları güncellemelidir:

| Dosya | Zorunluluk | İçerik |
|-------|-----------|--------|
| `PROGRESS.md` | **Zorunlu** | Bu PR'ın ne yaptığını açıklayan en az 1 satır |
| `TODO.md` | **Zorunlu** | Tamamlanan task'lar `[x]`, yeni task'lar `[ ]` |
| `docs/adr/NNNN-*.md` | Mimari karar varsa | Kararın gerekçesi, alternatifleri, sonuçları |
| `shared/api/openapi.yaml` | API değiştiyse | Yeni/değişen endpoint'ler |

**Kod değişikliği** sayılan dizinler: `server/`, `web/src/`, `client/src/`, `client/src-tauri/`, `cli/`, `e2e/tests/`, `deploy/k8s/`, `deploy/compose/`, `.github/workflows/`

**İstisna:** `docs: fix typo` gibi salt dokümantasyon commit'leri bu kuraldan muaftır.

### 2. Otomatik Zorlama Mekanizmaları

Üç katmanlı zorlama:

#### Katman 1: Pre-commit Hook (yerel)
`scripts/check-tracking-files.sh` — staged dosyaları analiz eder. Kod dosyası varken `PROGRESS.md` veya `TODO.md` eksikse commit'i bloklar ve açıklayıcı mesaj gösterir.

```
pip install pre-commit
pre-commit install
```

Kurulum sonrası her `git commit` öncesinde otomatik çalışır. Meşru atlatma: `SKIP_TRACKING_CHECK=1 git commit ...`

#### Katman 2: GitHub PR Template
`.github/PULL_REQUEST_TEMPLATE.md` — PR açıldığında checklist otomatik gelir. Reviewer `PROGRESS.md` / `TODO.md` güncellenip güncellenmediğini görebilir.

#### Katman 3: CI Lint (hafif)
`scripts/check-tracking-files.sh` CI'da da çalışır (`.github/workflows/security.yml` veya ayrı job). Pre-commit hook kurulmamış ortamlarda da yakalar.

### 3. ADR Zorunluluğu

Aşağıdaki durumlarda **mutlaka** ADR yazılır:

- Teknoloji seçimi (yeni kütüphane, yeni altyapı bileşeni)
- Güvenlik modeli değişikliği
- Veri modeli migration stratejisi kararı
- Deployment / operasyon paradigması değişikliği
- Önceki bir ADR'ın supersede edilmesi

ADR'lar `docs/adr/NNNN-kısa-başlık.md` formatında commit edilir. Hiçbir ADR hafıza dışında (Notion, Slack, email) tutulmaz.

### 4. Onboarding Kuralı

Yeni geliştirici (veya yeni AI session) başlamadan önce şunları okur:
1. `CLAUDE.md` — proje bağlamı
2. `PROGRESS.md` — güncel durum
3. `TODO.md` — aktif task'lar
4. `RULES.md` — geliştirme kuralları
5. `docs/adr/README.md` — mimari kararlar indeksi

## Alternatifler Değerlendirilen

### A: Sadece RULES.md'ye yazmak
**Reddedildi.** Zaten yazılıydı, uygulanmadı. Yazılı kural tek başına yetmez; otomasyon gerekir.

### B: Ayrı "docs commit" zorunluluğu
**Reddedildi.** İki ayrı commit = iki PR review = geliştiricileri ikinci commit'i atlamaya iter. Tracking güncellemesi asıl commit'e dahil edilmeli.

### C: CI'da tam diff analizi
**Reddedildi (şimdilik).** Gereksiz karmaşıklık. Lightweight pre-commit hook + PR template yeterli.

### D: Proje yönetim aracı (Jira, Linear, GitHub Issues)
**Reddedildi.** Harici araç bağımlılığı yaratır, offline çalışmayı kırar. Markdown dosyaları repoyla birlikte versiyonlanır; araçsız çalışılabilir.

## Sonuçlar

**Olumlu:**
- Yeni geliştirici / AI session başladığında proje durumu doğru ve güncel
- Git history tek kaynak of truth: kod + tracking değişikliği aynı commit'te
- Kod review sırasında tracking güncellemesi görünür olur

**Olumsuz / Kabul edilen trade-off:**
- Her commit'e küçük ek yük (2 dosya güncelleme)
- Pre-commit hook kurulum adımı gerekiyor (`pre-commit install`)
- Hook bypass mümkün (`SKIP_TRACKING_CHECK=1`) — disiplin hâlâ insan kararına dayanır

## Uygulama

- `scripts/check-tracking-files.sh` oluşturuldu
- `.pre-commit-config.yaml`'a hook eklendi
- `.github/PULL_REQUEST_TEMPLATE.md` oluşturuldu
- `RULES.md` güncellendi (enforcement notu eklendi)
- Mevcut TODO.md retroaktif olarak düzeltildi (22 PR `[x]` işaretlendi)
