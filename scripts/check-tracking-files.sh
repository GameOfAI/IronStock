#!/usr/bin/env bash
# check-tracking-files.sh
#
# Pre-commit guard: kod dosyaları commit'e dahil edildiğinde
# PROGRESS.md ve TODO.md'nin de güncellendiğini doğrular.
#
# Kural kaynağı: RULES.md "Push öncesi tracking dosyaları kontrolü"
#                docs/adr/0012-development-tracking-discipline.md
#
# Meşru bypass: SKIP_TRACKING_CHECK=1 git commit -m "..."
# (WIP / kısmi commit / sadece format düzeltmesi)

set -euo pipefail

# --- Bypass kontrolü ---
if [ "${SKIP_TRACKING_CHECK:-0}" = "1" ]; then
  echo "⚠️  Tracking kontrolü atlandı (SKIP_TRACKING_CHECK=1)"
  exit 0
fi

# --- Staged dosyaları al ---
staged=$(git diff --cached --name-only 2>/dev/null || true)

if [ -z "$staged" ]; then
  exit 0
fi

# --- Kod dosyası var mı? ---
code_changed=false
while IFS= read -r f; do
  case "$f" in
    server/*|\
    web/src/*|\
    client/src/*|\
    client/src-tauri/*|\
    cli/*|\
    e2e/tests/*|\
    deploy/k8s/*|\
    deploy/compose/*|\
    .github/workflows/*)
      code_changed=true
      break
      ;;
  esac
done <<< "$staged"

# Kod değişikliği yoksa (docs-only, config, root scripts) → geç
if ! $code_changed; then
  exit 0
fi

# --- PROGRESS.md ve TODO.md staged mi? ---
missing=()
echo "$staged" | grep -qx "PROGRESS\.md" || missing+=("PROGRESS.md")
echo "$staged" | grep -qx "TODO\.md"     || missing+=("TODO.md")

if [ ${#missing[@]} -eq 0 ]; then
  exit 0
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ❌  TRACKING KURALI İHLALİ                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Kod değişikliği commit'e dahil edilmiş, ancak şu dosyalar eksik:"
for f in "${missing[@]}"; do
  echo "    • $f"
done
echo ""
echo "  KURAL (RULES.md + ADR-0012):"
echo "  Her feature/fix commit'inde PROGRESS.md + TODO.md aynı commit'e girer."
echo "  • PROGRESS.md : ne yapıldığını 1+ satırla açıkla"
echo "  • TODO.md     : tamamlanan task'ları [x] işaretle, yeni task'ları ekle"
echo ""
echo "  MEŞRU BYPASS (WIP / format / kısmi commit):"
echo "    SKIP_TRACKING_CHECK=1 git commit -m \"...\""
echo ""
exit 1
