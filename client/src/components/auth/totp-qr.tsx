/**
 * TOTPQRCode — `otpauth://` URI'yi görsel QR koduna çevirir.
 * Client paketi versiyonu — web/src/components/auth/totp-qr.tsx ile aynı.
 */

import { QRCodeSVG } from 'qrcode.react';

interface TOTPQRCodeProps {
  uri: string;
  size?: number;
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
