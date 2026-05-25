/**
 * user-error.ts — Sanitize internal errors into user-friendly messages.
 *
 * Technical details (stack traces, CSP violations, WebAssembly errors, etc.)
 * must never be shown to the end user. They leak internal architecture and
 * confuse non-technical users.
 *
 * Usage:
 *   catch (err) {
 *     toast({ description: userFriendlyError(err) });
 *   }
 */

const TECHNICAL_PATTERNS: Array<[RegExp, string]> = [
  [/WebAssembly/i, 'Tarayıcı güvenlik ayarları bu işlemi engelledi. Sayfayı yenileyip tekrar deneyin.'],
  [/Content.Security.Policy/i, 'Tarayıcı güvenlik politikası bu işlemi engelledi. Sayfayı yenileyip tekrar deneyin.'],
  [/Failed to fetch|NetworkError|net::ERR/i, 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.'],
  [/timeout|ETIMEDOUT/i, 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.'],
  [/JSON\.parse|Unexpected token/i, 'Sunucudan beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin.'],
  [/crypto|subtle|digest|encrypt|decrypt/i, 'Şifreleme işlemi başarısız oldu. Lütfen tekrar deneyin.'],
  [/CORS|cross-origin/i, 'Sunucu bağlantı hatası. Yöneticinize başvurun.'],
  [/chunk|module|import/i, 'Uygulama yüklenirken hata oluştu. Sayfayı yenileyip tekrar deneyin.'],
  [/QuotaExceeded|localStorage|sessionStorage/i, 'Tarayıcı depolama alanı dolu. Tarayıcı verilerini temizleyip tekrar deneyin.'],
  [/AbortError|aborted/i, 'İşlem iptal edildi.'],
];

export function userFriendlyError(err: unknown): string {
  if (err == null) return 'Bilinmeyen bir hata oluştu.';

  const raw = err instanceof Error ? err.message : String(err);

  // If the message is already a clean Turkish/English user message from the API,
  // pass it through (API errors like "Şifre en az 12 karakter olmalı" are fine).
  // Heuristic: if it contains no technical keywords, it's likely user-facing.
  for (const [pattern, friendly] of TECHNICAL_PATTERNS) {
    if (pattern.test(raw)) return friendly;
  }

  // If message is very long (>200 chars) it's likely a stack trace or technical dump
  if (raw.length > 200) return 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';

  // Otherwise pass through — it's likely an API error message meant for the user
  return raw;
}
