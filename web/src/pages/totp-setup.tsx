/**
 * TOTP setup wizard.
 *
 * Reached AFTER /auth/register (flow not yet wired in PR-W2 — admin
 * creates accounts; PR-W3 will surface a "register new user" button).
 * For PR-W2 this page is reachable by passing a tmp_token via route
 * state: navigate('/totp/setup', { state: { tmpToken } }).
 *
 * Steps:
 *   1. POST /auth/totp/init        → otpauth_uri + secret_base32
 *   2. Show QR (data URI in iframe / canvas) + secret for manual entry
 *   3. User scans + types first 6-digit code
 *   4. POST /auth/totp/verify      → 10 plaintext recovery codes (ONCE)
 *   5. Show codes + "I've saved them" confirmation
 *   6. Navigate to /login (status now 'active')
 */

import * as React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useTOTPInitMutation, useTOTPVerifyMutation } from '@/api/auth';

export default function TOTPSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const tmpToken = (location.state as { tmpToken?: string } | null)?.tmpToken;
  if (!tmpToken) {
    return <Navigate to="/login" replace />;
  }

  const initMut = useTOTPInitMutation();
  const verifyMut = useTOTPVerifyMutation();
  const [phase, setPhase] = React.useState<'enroll' | 'verify' | 'recovery_codes'>('enroll');
  const [otpAuthUrl, setOtpAuthUrl] = React.useState('');
  const [secretBase32, setSecretBase32] = React.useState('');
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (phase !== 'enroll') return;
    initMut.mutate(tmpToken, {
      onSuccess: (res) => {
        setOtpAuthUrl(res.otpauth_uri);
        setSecretBase32(res.secret_base32);
        setPhase('verify');
      },
      onError: (err) => {
        toast({
          title: 'TOTP başlatılamadı',
          description: err.message,
          variant: 'destructive',
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tmpToken]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
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
    toast({
      title: 'TOTP kurulumu tamamlandı',
      description: 'Şimdi giriş yapabilirsiniz.',
    });
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>TOTP Kurulumu</CardTitle>
          <CardDescription>
            Authenticator uygulamanızda QR kodu tarayın ve gösterilen ilk kodu girin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phase === 'enroll' && (
            <p className="text-sm text-muted-foreground">Hazırlanıyor...</p>
          )}

          {phase === 'verify' && (
            <form onSubmit={onVerify} className="flex flex-col gap-4">
              <div className="rounded-md border bg-muted/30 p-4 text-center">
                {/* MVP: QR rendering Faz 5 polish'inde kütüphane ile.
                    Şimdilik secret manuel olarak gösteriliyor. */}
                <p className="text-xs uppercase text-muted-foreground">Manuel anahtar</p>
                <code className="mt-2 block break-all text-sm">{secretBase32}</code>
                <p className="mt-3 text-xs text-muted-foreground">
                  veya bu URI'yi authenticator uygulamanıza yapıştırın:
                </p>
                <code className="mt-2 block break-all text-xs">{otpAuthUrl}</code>
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
                  Güvenli bir yere kaydedin (parola yöneticisi, fiziksel kasa). Master parolanızı
                  unutursanız hesabınızı bunlarla kurtarabilirsiniz.
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
