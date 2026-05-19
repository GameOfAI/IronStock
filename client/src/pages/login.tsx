/**
 * Login akışı (PR-SEC2 sonrası 2-fazlı):
 *
 *   Faz 1: username + master_password → POST /auth/login
 *     - hasTOTP && totp_required → 401 mfa_required → Faz 2 dialog'u açılır
 *     - !hasTOTP && totp_required → tam session + must_setup_totp=true → MustSetupTOTPGate
 *     - !totp_required → direkt access_token → Faz 3 keypair çözümlemesi
 *
 *   Faz 2: TOTP dialog → kullanıcı kod girer → aynı POST /auth/login retry
 *     - dialog "İptal" ile kapatılabilir; form temizlenmez ama substep idle olur
 *
 *   Faz 3 (her iki yolun ortak son adımı): GET /users/me/keypair, KEK türet,
 *   private key çöz, setSession, keyring'e kaydet, navigate('/inventory').
 *   must_setup_totp=true ise MustSetupTOTPGate /totp/setup'a yönlendirir.
 *
 * Web/login.tsx ile UX paritesi sağlanmıştır.
 */

import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLoginMutation } from '@/api/auth';
import { fetchMyKeypair } from '@/api/me';
import { useAuthStore } from '@/store/auth';
import { decryptPrivateKey, deriveKEK, fromBase64, toBase64 } from '@/lib/crypto';
import type { KEKParams } from '@/lib/crypto';
import { ApiError, ErrCode } from '@/api/errors';
import { kekStore } from '@/lib/tauri';

type Substep = 'idle' | 'authenticating' | 'fetching_keypair' | 'deriving_key' | 'unlocking';

function substepLabel(s: Substep): string {
  switch (s) {
    case 'authenticating':
      return 'Kimlik doğrulanıyor...';
    case 'fetching_keypair':
      return 'Anahtar paketi alınıyor...';
    case 'deriving_key':
      return 'Anahtar türetiliyor (yavaş olabilir)...';
    case 'unlocking':
      return 'Kasa açılıyor...';
    default:
      return 'Giriş Yap';
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const setSession = useAuthStore((s) => s.setSession);
  const loginMut = useLoginMutation();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

  // TOTP dialog state — sadece server 401 mfa_required dönerse açılır.
  const [totpDialogOpen, setTotpDialogOpen] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState('');

  const [substep, setSubstep] = React.useState<Substep>('idle');

  const busy = substep !== 'idle';
  const fromPath = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;

  // Ortak login akışı — hem ilk submit hem TOTP retry için kullanılır.
  async function runLogin(opts: { totp?: string }) {
    setSubstep('authenticating');
    const loginRes = await loginMut.mutateAsync({
      username: username.toLowerCase(),
      master_password: password,
      totp_code: opts.totp || undefined,
    });

    setSubstep('fetching_keypair');
    const keypair = await fetchMyKeypair(loginRes.access_token);

    setSubstep('deriving_key');
    const kekSalt = fromBase64(keypair.kek_salt);
    const kekParams = keypair.kek_params as unknown as KEKParams;
    const kek = await deriveKEK(password, kekSalt, kekParams);

    setSubstep('unlocking');
    const privateKeyEnc = fromBase64(keypair.private_key_enc);
    const privateKey = await decryptPrivateKey(privateKeyEnc, kek);

    setSession({
      user: { id: loginRes.user_id, username, roles: loginRes.roles },
      accessToken: loginRes.access_token,
      refreshToken: loginRes.refresh_token,
      kek,
      privateKey,
      mustSetupTOTP: loginRes.must_setup_totp,
    });

    // KEK'i OS keyring'e kaydet (Tauri ortamında; browser'da no-op).
    await kekStore(username.toLowerCase(), toBase64(kek));

    // Son kullanıcı adını kaydet → uygulama yeniden başlatılınca bootstrap için.
    localStorage.setItem('envanter.last_username', username.toLowerCase());

    // PR-SEC2: must_setup_totp=true ise MustSetupTOTPGate /totp/setup'a yönlendirir.
    // must_setup_totp=false ise doğrudan hedef route'a git.
    navigate(fromPath ?? '/inventory', { replace: true });
  }

  // Faz 1: username + master_password submit.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username || !password) {
      toast({
        title: 'Eksik alan',
        description: 'Kullanıcı adı ve şifre zorunlu.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runLogin({});
    } catch (err) {
      setSubstep('idle');
      // Sunucu 2FA istiyorsa TOTP dialog'unu aç.
      if (err instanceof ApiError && err.code === ErrCode.MFARequired) {
        setTotpCode('');
        setTotpDialogOpen(true);
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Giriş başarısız.';
      toast({ title: 'Giriş başarısız', description: msg, variant: 'destructive' });
    }
  }

  // Faz 2: TOTP dialog submit.
  async function onTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!totpCode || totpCode.length < 6) {
      toast({
        title: 'Eksik kod',
        description: '6 haneli TOTP kodunu girin.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runLogin({ totp: totpCode });
      // Success → dialog navigation ile zaten kapanıyor.
    } catch (err) {
      setSubstep('idle');
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Doğrulama başarısız.';
      toast({ title: 'Doğrulama başarısız', description: msg, variant: 'destructive' });
    }
  }

  function handleTotpCancel() {
    setTotpDialogOpen(false);
    setTotpCode('');
    setSubstep('idle');
  }

  const totpBusy = totpDialogOpen && busy;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>IronStock Girişi</CardTitle>
          <CardDescription>Kullanıcı adınız ve master parolanız.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Kullanıcı Adı</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Master Parola</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                minLength={12}
                disabled={busy}
              />
            </div>

            <Button type="submit" disabled={busy} className="mt-2">
              {substepLabel(substep)}
            </Button>

            <div className="flex items-center justify-center pt-2 text-xs">
              <button
                type="button"
                onClick={() => navigate('/admin-setup')}
                className="text-muted-foreground underline hover:text-foreground"
                disabled={busy}
              >
                İlk kurulum / Admin paneli
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* TOTP dialog — sadece server mfa_required dönerse açılır. */}
      <Dialog
        open={totpDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleTotpCancel();
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>İki Faktörlü Doğrulama</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{username}</span> için authenticator kodunu girin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onTotpSubmit} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-code">TOTP Kodu</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={8}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                required
                disabled={totpBusy}
                className="text-center font-mono text-xl tracking-[0.4em]"
              />
              <p className="text-xs text-muted-foreground">
                Google Authenticator veya uyumlu uygulamada gösterilen 6 haneli kod.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleTotpCancel}
                disabled={totpBusy}
              >
                İptal
              </Button>
              <Button type="submit" disabled={totpBusy}>
                {totpBusy ? substepLabel(substep) : 'Doğrula'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
