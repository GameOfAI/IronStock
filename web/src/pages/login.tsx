/**
 * Login page.
 *
 * Two-phase flow:
 *   Phase 1: username + password submitted.
 *   Phase 2: if server returns mfa_required, a TOTP dialog pops up over the
 *            login form — user enters the 6-digit code and clicks "Doğrula".
 *            The same username/password are reused; only totp_code is added.
 *
 * After server auth:
 *   3. GET /users/me/keypair      → keypair material
 *   4. Argon2id(master_pwd, kek_salt, kek_params)
 *   5. AES-GCM-decrypt(private_key_enc, KEK)
 *   6. authStore.setSession(...)
 *   7. navigate(state.from || '/inventory')
 *
 * Step 4 takes ~200-500ms on a modern CPU; we surface the substep label
 * ("Anahtar türetiliyor...") so the user knows we're not hung.
 */

import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
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
import type { SessionUser } from '@/store/auth';
import { decryptPrivateKey, deriveKEK, fromBase64 } from '@/lib/crypto';
import type { KEKParams } from '@/lib/crypto';
import { ApiError, ErrCode } from '@/api/errors';

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
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);
  const loginMut = useLoginMutation();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

  // TOTP dialog state
  const [totpDialogOpen, setTotpDialogOpen] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState('');
  const [rememberDevice, setRememberDevice] = React.useState(false);

  const [substep, setSubstep] = React.useState<Substep>('idle');

  const busy = substep !== 'idle';

  const rawFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const fromPath = rawFrom && rawFrom !== '/change-password' ? rawFrom : undefined;

  // Core login flow — used by both Phase 1 (no TOTP) and Phase 2 (with TOTP)
  async function runLogin(opts: { totp?: string; remember?: boolean }) {
    setSubstep('authenticating');
    const loginRes = await loginMut.mutateAsync({
      username: username.toLowerCase(),
      master_password: password,
      totp_code: opts.totp || undefined,
      remember_device: opts.remember || undefined,
    });

    setSubstep('fetching_keypair');
    const keypair = await fetchMyKeypair(loginRes.access_token);

    const sessionUser: SessionUser = {
      id: loginRes.user_id,
      username,
      roles: loginRes.roles,
    };

    const kekParams = keypair.kek_params as unknown as KEKParams & { alg?: string };

    if (kekParams?.alg === 'none') {
      setBootstrapSession({
        user: sessionUser,
        accessToken: loginRes.access_token,
        refreshToken: loginRes.refresh_token,
        mustChangePassword: loginRes.must_change_password,
      });
    } else {
      setSubstep('deriving_key');
      const kekSalt = fromBase64(keypair.kek_salt);
      const kek = await deriveKEK(password, kekSalt, kekParams);

      setSubstep('unlocking');
      const privateKeyEnc = fromBase64(keypair.private_key_enc);
      const privateKey = await decryptPrivateKey(privateKeyEnc, kek);

      setSession({
        user: sessionUser,
        accessToken: loginRes.access_token,
        refreshToken: loginRes.refresh_token,
        kek,
        privateKey,
        mustChangePassword: loginRes.must_change_password,
      });
    }

    navigate(fromPath ?? '/inventory', { replace: true });
  }

  // Phase 1: username + password form submit
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
      // Server says 2FA is required → open TOTP dialog
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
      toast({
        title: 'Giriş başarısız',
        description: msg,
        variant: 'destructive',
      });
    }
  }

  // Phase 2: TOTP dialog submit
  async function onTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!totpCode || totpCode.length < 6) {
      toast({
        title: 'Eksik kod',
        description: '6 haneli doğrulama kodunu girin.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runLogin({ totp: totpCode, remember: rememberDevice });
      // Success → dialog closes automatically via navigation
    } catch (err) {
      setSubstep('idle');
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Doğrulama başarısız.';
      toast({
        title: 'Doğrulama başarısız',
        description: msg,
        variant: 'destructive',
      });
    }
  }

  function handleTotpCancel() {
    setTotpDialogOpen(false);
    setTotpCode('');
    setRememberDevice(false);
    setSubstep('idle');
  }

  const totpBusy = totpDialogOpen && busy;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Envanter Girişi</CardTitle>
          <CardDescription>
            Kullanıcı adınız ve master parolanızla giriş yapın.
          </CardDescription>
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
              {busy && !totpDialogOpen ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {substepLabel(substep)}
                </>
              ) : (
                substepLabel('idle')
              )}
            </Button>

            <div className="flex justify-between text-sm text-muted-foreground">
              <Link to="/recover" className="hover:text-foreground">
                Hesabınızı mı unuttunuz?
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* TOTP dialog — appears after successful password auth when MFA is required */}
      <Dialog open={totpDialogOpen} onOpenChange={(open) => { if (!open) handleTotpCancel(); }}>
        <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              İki Faktörlü Doğrulama
            </DialogTitle>
            <DialogDescription>
              Hesabınızda 2FA aktif. Authenticator uygulamanızdaki{' '}
              <strong>6 haneli kodu</strong> girin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onTotpSubmit} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-code" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                Doğrulama Kodu
              </Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={8}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123 456"
                className="text-center text-xl tracking-[0.4em] font-mono"
                autoFocus
                required
                disabled={totpBusy}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={totpBusy}
              />
              Bu cihazı 30 gün hatırla
            </label>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleTotpCancel}
                disabled={totpBusy}
              >
                İptal
              </Button>
              <Button
                type="submit"
                disabled={totpBusy || totpCode.length < 6}
              >
                {totpBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {substepLabel(substep)}
                  </>
                ) : (
                  'Doğrula'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
