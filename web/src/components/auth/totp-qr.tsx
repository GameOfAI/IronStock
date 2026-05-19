/**
 * TOTPQRCode — `otpauth://` URI'yi görsel QR koduna çevirir.
 *
 * Kullanıcı QR'ı Google Authenticator / 1Password / Authy ile tarayarak
 * TOTP secret'ını uygulamasına eklenir. Manuel giriş için secret string
 * caller tarafından "fallback" olarak ayrıca gösterilebilir.
 *
 * SVG output (lightweight, ölçeklenebilir). 192px varsayılan boyut.
 */

import { QRCodeSVG } from 'qrcode.react';

interface TOTPQRCodeProps {
  /** otpauth://totp/Issuer:user?secret=...&issuer=... */
  uri: string;
  size?: number;
  /** Dark mode için: cell rengini tema renkleriyle değiştirebilir.
   *  Varsayılan siyah/beyaz tarayıcı uyumluluğu en yüksek değer. */
  bgColor?: string;
  fgColor?: string;
}

export function TOTPQRCode({
  uri,
  size = 192,
  bgColor = '#ffffff',
  fgColor = '#000000',
}: TOTPQRCodeProps) {
  return (
    <div className="inline-flex rounded-md border bg-white p-3" aria-label="TOTP QR kodu">
      <QRCodeSVG
        value={uri}
        size={size}
        bgColor={bgColor}
        fgColor={fgColor}
        level="M"
        marginSize={0}
      />
    </div>
  );
}
