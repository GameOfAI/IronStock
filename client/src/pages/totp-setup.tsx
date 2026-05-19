/**
 * TOTP kurulum sihirbazı — web/src/pages/totp-setup.tsx ile aynı mantık.
 *
 * Buraya route state ile tmpToken gelir:
 *   navigate('/totp/setup', { state: { tmpToken } })
 *
 * Adımlar:
 *   1. POST /auth/totp/init   → otpauth_uri + secret_base32
 *   2. QR / secret göster + kullanıcı kodu girer
 *   3. POST /auth/totp/verify → 10 recovery code (tek gösterim)
 *   4. Kodları onayla → /login
 */

import * as React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useTOTPInitMutation, useTOTPVerifyMutation } from '@/api/auth';
import { TOTPQRCode } from '@/components/auth/totp-qr';

export default function TOTPSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const initMut = useTOTPInitMutation();
  const verifyMut = useTOTPVerifyMutation();

  const [phase, setPhase] = React.useState<'enroll' | 'verify' | 'recovery_codes'>('enroll');
  const [otpAuthUrl, setOtpAuthUrl] = React.useState('');
  const [secretBase32, setSecretBase32] = React.useState('');
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);

  const tmpToken = (location.state as { tmpToken?: string } | null)?.tmpToken;

  React.useEffect(() => {
    if (!tmpToken || phase !== 'enroll') return;
    initMut.mutate(tmpToken, {
      onSuccess: (res) => {
        setOtpAuthUrl(res.otpauth_uri);
        setSecretBase32(res.secret_base32);
        setPhase('verify');
      },
      onError: (err) => {
        toast({ title: 'TOTP başlatılamadı', description: err.message, variant: 'destructive' });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tmpToken]);

  if (!tmpToken) return <Navigate to="/login" replace />;

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!code || !tmpToken) return;
    try {
      const res = await verifyMut.mutateAsync({ tmpToken, code });
      setRecoveryCodes(res.recovery_codes);
      setPhase('recovery_codes');
    } catch (err) {
      toast({
        title: 'Kod yanlış',
        description: err instanceof Error ? err.message : 'TOTP doğrulaması başarısız.',
        variant: 'destructive',
      });
    }
  }

  function onConfirmSavedCodes() {
    toast({ title: 'TOTP kurulumu tamamlandı', description: 'Şimdi giriş yapabilirsiniz.' });
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>TOTP Kurulumu</CardTitle>
          <CardDescription>
            Authenticator uygulamanızda QR kodu tarayın ve ilk kodu girin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phase === 'enroll' && (
            <p className="text-sm text-muted-foreground">Hazırlanıyor...</p>
          )}

          {phase === 'verify' && (
            <form onSubmit={onVerify} className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-3 rounded-md border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  Authenticator uygulamanızla aşağıdaki QR kodu tarayın.
                </p>
                <TOTPQRCode uri={otpAuthUrl} />
                <details className="w-full text-center">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    QR tarayamıyor musunuz? Manuel anahtar
                  </summary>
                  <code className="mt-2 block break-all rounded bg-background px-2 py-1 text-sm">
                    {secretBase32}
                  </code>
                </details>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Authenticator kodu</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  autoFocus
                />
              </div>

              <Button type="submit" disabled={verifyMut.isPending}>
                {verifyMut.isPending ? 'Doğrulanıyor...' : 'Doğrula'}
              </Button>
            </form>
          )}

          {phase === 'recovery_codes' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
                <p className="text-sm font-semibold text-destructive">
                  Bu kodlar SADECE bir kez gösterilir.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Güvenli bir yere kaydedin. Master parolanızı unutursanız bunlarla
                  hesabınızı kurtarabilirsiniz.
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-4 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <li key={c} className="select-all">
                    {c}
                  </li>
                ))}
              </ul>
              <Button onClick={onConfirmSavedCodes}>Kaydettim, devam et</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
