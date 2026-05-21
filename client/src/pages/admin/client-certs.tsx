/**
 * /admin/client-certs — Admin istemci sertifikaları (mTLS) yönetim sayfası.
 *
 * Tauri client'ta cert yönetimi web UI üzerinden yapılır (nginx mTLS mimarisi).
 * Bu sayfa özet bilgi + web UI'ye yönlendirme gösterir.
 *
 * Not: Tam implementasyon (CA yönetimi, cert üretme vb.) web/src/pages/admin/client-certs.tsx
 * referans alınarak Faz 5'te eklenebilir.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Fingerprint, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/store/connection';

export default function AdminClientCertsPage() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);

  function openWebAdmin() {
    if (serverUrl) {
      window.open(`${serverUrl}/admin/client-certs`, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">İstemci Sertifikaları</h1>
          <p className="text-[13px] text-muted-foreground">
            mTLS sertifika yönetimi (PR-SEC3)
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="h-4 w-4" />
              Sertifika Yönetimi
            </CardTitle>
            <CardDescription>
              İstemci sertifikası (mTLS) yönetimi için lütfen web admin arayüzünü kullanın.
              CA yönetimi, sertifika üretme ve revoke işlemleri web UI'de mevcuttur.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={openWebAdmin}
              disabled={!serverUrl}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Web Admin UI'de Aç
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
