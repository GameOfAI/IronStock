/**
 * ConfigPage — sunucu bağlantı ayarları ekranı.
 *
 * Kullanıcı ilk çalıştırmada veya bağlantıyı değiştirmek istediğinde gelir.
 *
 * Bölümler:
 *   1. Sunucu URL + TLS skip-verify (mevcut)
 *   2. mTLS client sertifikası (PR-SEC3) — opsiyonel .p12 dosyası + parola
 *
 * mTLS akışı:
 *   - Kullanıcı admin panelinden kendi .p12'sini indirir.
 *   - Bu ekranda "Sertifika Seç" ile dosyayı seçer, parolayı girer.
 *   - Dosya içeriği base64 olarak connection store'a kaydedilir.
 *   - Sonraki tüm tls_fetch çağrıları bu sertifikayı reqwest Identity'si olarak kullanır.
 *
 * Güvenlik notu: .p12 içeriği ve parola localStorage'da tutulur.
 * Tauri native app bağlamında bu kabul edilebilir — OS disk şifrelemesi korur.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, ShieldCheck, Upload, X, Eye, EyeOff, WifiOff, MonitorOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConnectionStore } from '@/store/connection';

// ─── Password field with show/hide ───

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
        aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Main page ───

export default function ConfigPage() {
  const navigate = useNavigate();
  const {
    serverUrl,
    tlsSkipVerify,
    clientCertP12Base64,
    clientCertPassword,
    offlineModeEnabled,
    contentProtectionEnabled,
    setConnection,
    setClientCert,
    clearClientCert,
    setOfflineMode,
    setContentProtection: storeSetContentProtection,
  } = useConnectionStore();

  const [url, setUrl] = React.useState(serverUrl || 'https://');
  const [skipTls, setSkipTls] = React.useState(tlsSkipVerify);
  const [offlineMode, setOfflineModeLocal] = React.useState(offlineModeEnabled);
  const [contentProtection, setContentProtectionLocal] = React.useState(contentProtectionEnabled);
  const [error, setError] = React.useState('');

  // mTLS cert state
  const [certFileName, setCertFileName] = React.useState<string | null>(null);
  const [certP12Base64, setCertP12Base64] = React.useState(clientCertP12Base64);
  const [certPassword, setCertPassword] = React.useState(clientCertPassword);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const hasCert = certP12Base64.length > 0;

  // Read picked .p12 file as base64
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCertFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:application/x-pkcs12;base64,<b64>"
      const b64 = result.split(',')[1] ?? '';
      setCertP12Base64(b64);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveCert() {
    setCertP12Base64('');
    setCertPassword('');
    setCertFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    clearClientCert();
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = url.trim();
    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      setError('Geçerli bir URL girin (http:// veya https:// ile başlamalı).');
      return;
    }

    setConnection(trimmed, skipTls);
    setClientCert(certP12Base64, certPassword);
    setOfflineMode(offlineMode);
    storeSetContentProtection(contentProtection);
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
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
          <form onSubmit={handleSave} className="flex flex-col gap-5">

            {/* ── Sunucu URL ── */}
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

            {/* ── TLS skip-verify ── */}
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

            {/* ── mTLS Client Sertifikası ── */}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">Client Sertifikası (mTLS)</span>
                <span className="ml-auto text-[11px] text-muted-foreground">opsiyonel</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sunucu mTLS gerektiriyorsa admin panelinden indirdiğiniz .p12 dosyasını seçin.
              </p>

              {hasCert ? (
                /* Sertifika yüklü — göster ve kaldır seçeneği */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">
                      {certFileName ?? 'Sertifika yüklendi'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveCert}
                      className="ml-auto shrink-0 rounded p-0.5 hover:bg-emerald-500/20"
                      aria-label="Sertifikayı kaldır"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cert-password" className="text-[12px]">
                      Sertifika Parolası
                    </Label>
                    <PasswordInput
                      id="cert-password"
                      placeholder="••••••••"
                      value={certPassword}
                      onChange={(e) => setCertPassword(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : (
                /* Sertifika yüklü değil — seç butonu */
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".p12,.pfx"
                    onChange={handleFileChange}
                    className="hidden"
                    id="cert-file-input"
                  />
                  <label
                    htmlFor="cert-file-input"
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    .p12 / .pfx dosyası seç
                  </label>
                </div>
              )}
            </div>

            {/* ── Offline Mod ── */}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">Offline Mod</span>
                <span className="ml-auto text-[11px] text-muted-foreground">opsiyonel</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Etkinleştirilirse ağ bağlantısı yokken yapılan değişiklikler yerel kuyruğa
                alınır. Bağlantı geri geldiğinde otomatik olarak sunucuya gönderilir.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="offline-mode"
                  type="checkbox"
                  checked={offlineMode}
                  onChange={(e) => setOfflineModeLocal(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="offline-mode" className="font-normal text-muted-foreground">
                  Offline modu etkinleştir
                </Label>
              </div>
            </div>

            {/* ── Ekran Yakalama Koruması ── */}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4">
              <div className="flex items-center gap-2">
                <MonitorOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">Ekran Yakalama Koruması</span>
                <span className="ml-auto rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  varsayılan açık
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Etkinken uygulama penceresi ekran paylaşımı, ekran kaydı ve ekran görüntüsü
                araçlarında gizlenir. Envanter içeriğinin sızmasını önler.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="content-protection"
                  type="checkbox"
                  checked={contentProtection}
                  onChange={(e) => setContentProtectionLocal(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="content-protection" className="font-normal text-muted-foreground">
                  Ekran yakalama korumasını etkinleştir
                </Label>
              </div>
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
