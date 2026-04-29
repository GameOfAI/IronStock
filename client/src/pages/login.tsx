/**
 * Login akışı (web/src/pages/login.tsx ile aynı mantık):
 *
 *   1. POST /auth/login           → access + refresh + user
 *   2. GET  /users/me/keypair     → keypair material
 *   3. Argon2id(master_pwd, kek_salt, kek_params) → KEK
 *   4. AES-GCM-decrypt(private_key_enc, KEK)      → private_key
 *   5. authStore.setSession(...)
 *   6. navigate('/inventory')
 *
 * Adım 3 ~200-500ms; "Anahtar türetiliyor..." etiketi gösterilir.
 * TOTP setup gerekiyorsa (tmp_token döner) /totp/setup'a yönlendirilir.
 */

import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useLoginMutation } from '@/api/auth';
import { fetchMyKeypair } from '@/api/me';
import { useAuthStore } from '@/store/auth';
import { decryptPrivateKey, deriveKEK, fromBase64, toBase64 } from '@/lib/crypto';
import type { KEKParams } from '@/lib/crypto';
import { ApiError } from '@/api/errors';
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
  const [totpCode, setTotpCode] = React.useState('');
  const [substep, setSubstep] = React.useState<Substep>('idle');

  const busy = substep !== 'idle';
  const fromPath = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username || !password || !totpCode) {
      toast({
        title: 'Eksik alan',
        description: 'Kullanıcı adı, şifre ve TOTP kodu zorunlu.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubstep('authenticating');
      const loginRes = await loginMut.mutateAsync({
        username: username.toLowerCase(),
        master_password: password,
        totp_code: totpCode,
      });

      // Sunucu TOTP setup gerektiriyorsa tmp_token ile wizard'a yönlendir
      if (loginRes.tmp_token) {
        navigate('/totp/setup', { state: { tmpToken: loginRes.tmp_token } });
        return;
      }

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
      });

      // KEK'i OS keyring'e kaydet (Tauri ortamında; browser'da no-op).
      await kekStore(username.toLowerCase(), toBase64(kek));

      navigate(fromPath ?? '/inventory', { replace: true });
    } catch (err) {
      setSubstep('idle');
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Giriş başarısız.';
      toast({ title: 'Giriş başarısız', description: msg, variant: 'destructive' });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>IronStock Girişi</CardTitle>
          <CardDescription>Kullanıcı adınız, master parolanız ve TOTP kodunuz.</CardDescription>
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp">TOTP Kodu</Label>
              <Input
                id="totp"
                type="text"
                maxLength={8}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                required
                disabled={busy}
              />
            </div>

            <Button type="submit" disabled={busy} className="mt-2">
              {substepLabel(substep)}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
