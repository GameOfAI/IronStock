## Özet

<!-- Ne değişti ve neden? 2-4 cümle. -->

## Değişiklik Türü

- [ ] ✨ Yeni özellik (feature)
- [ ] 🐛 Bug fix
- [ ] ♻️ Refactor (davranış değişikliği yok)
- [ ] 📦 Bağımlılık / config güncelleme
- [ ] 📝 Dokümantasyon
- [ ] 🔒 Güvenlik düzeltmesi

## Test

<!-- Nasıl test edildi? Hangi senaryolar kontrol edildi? -->

---

## Merge Öncesi Kontrol Listesi

> Tüm maddeler tamamlanmadan merge yapılmaz.

### Zorunlu — Her PR

- [ ] `PROGRESS.md` bu PR'ın ne yaptığını açıklayan en az 1 satır entry içeriyor
- [ ] `TODO.md`'de tamamlanan task'lar `[x]` işaretlendi, yeni task'lar eklendi
- [ ] CI (GitHub Actions) tüm job'larda ✅ yeşil
- [ ] `main` branch'e doğrudan push yapılmadı (branch → PR → merge)

### Koşullu — İlgili PR Türüne Göre

- [ ] **Yeni/değişen API** → `shared/api/openapi.yaml` güncellendi
- [ ] **Yeni tablo / kolon** → migration dosyası `server/migrations/NNNNN_*.sql` var
- [ ] **Mimari karar** → `docs/adr/NNNN-*.md` ADR yazıldı
- [ ] **Şema değişikliği** → `docs/diagrams/er.mmd` güncellendi
- [ ] **Yeni public Go paketi / fonksiyon** → unit test yazıldı
- [ ] **Yeni React bileşen** → Vitest testi yazıldı
- [ ] **Secret / credential içeren dosya** → `.gitignore`'da veya encrypted

### Güvenlik

- [ ] Secret field'lar (parola, token, key) hiçbir yerde plaintext log'lanmıyor
- [ ] Yeni endpoint'ler `RequireAccessToken` / `RequireRole` middleware'i kullanıyor
- [ ] Kullanıcı girdileri validate ediliyor

---

## İlgili Issue / PR

<!-- Closes #123 -->

## Ekran Görüntüsü / Demo (isteğe bağlı)

<!-- UI değişikliği varsa önce/sonra screenshot ekle -->
