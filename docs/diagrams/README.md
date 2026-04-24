# Diyagramlar

## Dosyalar

| Dosya | İçerik |
|-------|--------|
| [er.mmd](er.mmd) | Tam ER diyagram (Mermaid) — tüm tablolar ve ilişkiler |

## Mermaid Rendering

Mermaid diyagramları çeşitli şekilde görülebilir:

### VS Code
"Markdown Preview Mermaid Support" eklentisi. `.mmd` dosyaları için Mermaid preview açılır.

### Komut satırı
```bash
# PNG
npx @mermaid-js/mermaid-cli -i er.mmd -o er.png -b transparent

# SVG
npx @mermaid-js/mermaid-cli -i er.mmd -o er.svg
```

### GitHub / GitLab
Markdown dosyası içinde ```` ```mermaid ```` bloğunda otomatik render olur. Tam diyagramı markdown'a gömmek için:

````markdown
```mermaid
<er.mmd içeriği>
```
````

### Online
https://mermaid.live/ → dosya içeriğini yapıştır.

## Kardinalite Notasyonu

| Sembol | Anlam |
|--------|-------|
| `\|\|--\|\|` | Tam bire bir (both required) |
| `\|\|--o\|` | Bire sıfır-veya-bir (0 or 1) |
| `\|\|--o{` | Bire çok (0 veya daha fazla) |
| `\|\|--\|{` | Bire çok (en az 1) |

## Şema Değişiklikleri

ER diyagram, **kanonik tasarım belgesi**. Yeni tablo/kolon eklenince:

1. `er.mmd` güncellenir.
2. Karşılık gelen migration `server/migrations/` altına yazılır.
3. Büyük değişikliklerde ADR eklenir (`docs/adr/`).

Migration dosyaları ER'den üretilmez (Atlas kullanmıyoruz); elle yazılır ama ER ile tutarlı olmalı.
