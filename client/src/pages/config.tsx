/**
 * ConfigPage — sunucu bağlantı ayarları ekranı.
 *
 * Kullanıcı ilk çalıştırmada veya bağlantıyı değiştirmek istediğinde gelir.
 * Sunucu URL'ini girip kaydeder; ardından login'e yönlendirir.
 *
 * TLS skip verify: self-signed sertifikalı geliştirme ortamları için.
 * NOT: Tauri 2 native HTTP client (PR-C1 sonrası) bu flag'i kullanacak.
 * Şimdilik sadece store'a kaydedilir, browser fetch TLS'yi bypass edemez.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConnectionStore } from '@/store/connection';

export default function ConfigPage() {
  const navigate = useNavigate();
  const { serverUrl, tlsSkipVerify, setConnection } = useConnectionStore();

  const [url, setUrl] = React.useState(serverUrl || 'https://');
  const [skipTls, setSkipTls] = React.useState(tlsSkipVerify);
  const [error, setError] = React.useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = url.trim();
    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      setError('Geçerli bir URL girin (http:// veya https:// ile başlamalı).');
      return;
    }

    setConnection(trimmed, skipTls);
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Server className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Sunucu Bağlantısı</CardTitle>
          <CardDescription>
            Envanter sunucusunun adresini girin. Sistem yöneticinizden öğrenebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-url">Sunucu URL</Label>
              <Input
                id="server-url"
                type="url"
                placeholder="https://envanter.sirket.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="tls-skip"
                type="checkbox"
                checked={skipTls}
                onChange={(e) => setSkipTls(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="tls-skip" className="font-normal text-muted-foreground">
                TLS doğrulamasını atla (yalnızca geliştirme ortamı)
              </Label>
            </div>

            <Button type="submit" className="w-full">
              Bağlan
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
