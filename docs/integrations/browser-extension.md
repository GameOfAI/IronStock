# IronStock Browser Extension

Chrome/Edge/Brave tarayıcılar için credential autofill extension'ı.

## Özellikler

- Login form tespiti ve otomatik doldurma
- Popup'tan credential arama
- Context menu ile seçili metni IronStock'ta arama
- TOTP destekli giriş
- Otomatik token yenileme (refresh token)

## Kurulum (Geliştirici Modu)

1. Chrome'da `chrome://extensions/` adresine gidin
2. "Geliştirici modu"nu açın (sağ üst köşe)
3. "Paketlenmemiş öğe yükle" → `browser-extension/` dizinini seçin
4. Extension simgesi araç çubuğunda görünür

## Kullanım

### İlk Yapılandırma

1. Extension simgesine tıklayın
2. Sunucu URL'sini girin (ör. `https://ironstock.example.com`)
3. Kullanıcı adı ve şifre ile giriş yapın
4. TOTP gerekiyorsa kodu girin

### Otomatik Doldurma

1. Login formu olan bir sayfaya gidin
2. Extension simgesine tıklayın
3. Credential arayın veya site adıyla eşleşenleri görün
4. Credential'a tıklayın — form otomatik doldurulur

### Context Menu

Sayfada bir metin seçip sağ tıklayın → "IronStock'ta Ara" ile hızlı arama yapın.

## Mimari

```
browser-extension/
├── manifest.json              # Chrome Extension Manifest V3
├── src/
│   ├── background/
│   │   └── service-worker.js  # Context menu, mesaj yönetimi
│   ├── content/
│   │   └── autofill.js        # Login form tespiti, credential doldurma
│   ├── popup/
│   │   ├── popup.html         # Popup UI
│   │   ├── popup.js           # Popup logic (arama, giriş)
│   │   └── options.html       # Ayarlar sayfası
│   └── lib/
│       └── api-client.js      # IronStock API istemcisi
└── icons/                     # Extension simgeleri
```

## Güvenlik

- Token'lar `chrome.storage.local`'da saklanır (extension sandbox)
- Refresh token ile otomatik token yenileme
- Çıkış yapıldığında tüm token'lar temizlenir
- Content script DOM manipülasyonu minimal — sadece input value set
- `<all_urls>` host permission yalnızca autofill için gerekli

## Geliştirme

```bash
# Extension'ı Chrome'a yükleyin (geliştirici modu)
# Değişiklik yaptıktan sonra Extensions sayfasından "Yenile" tıklayın

# Service worker loglarını görmek için:
# chrome://extensions/ → IronStock → "Service worker" linki
```

## Kısıtlamalar

- E2E şifreleme henüz extension'da uygulanmadı — field değerleri sunucu tarafında çözülür
- Sadece Chromium tabanlı tarayıcılar desteklenir (Chrome, Edge, Brave)
- Firefox desteği Manifest V3 uyumluluğu sonrası eklenecek
- Icon dosyaları henüz eklenmedi (placeholder)
