/**
 * Recovery flow.
 *
 * Two-step page split by internal state:
 *   1. RecoverInit: {username, recovery_code} → tmp_token (purpose=recovery)
 *   2. RecoverComplete: {new_master_password} →
 *        - generate fresh X25519 keypair (item_shares accessibility lost,
 *          ADR-0004 §9 — UI shows prominent warning before submit)
 *        - derive new KEK from new master password
 *        - encrypt new private_key with new KEK
 *        - submit to /auth/recover/complete
 *        - server returns 10 fresh recovery codes (shown once)
 *        - navigate to /login
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useRecoverCompleteMutation, useRecoverInitMutation } from '@/api/auth';
import {
  DEFAULT_KEK_PARAMS,
  deriveKEK,
  encryptPrivateKey,
  generateX25519Keypair,
  randomKEKSalt,
  toBase64,
} from '@/lib/crypto';

type Phase = 'init' | 'warn' | 'complete' | 'codes';

export default function RecoverPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const initMut = useRecoverInitMutation();
  const completeMut = useRecoverCompleteMutation();

  const [phase, setPhase] = React.useState<Phase>('init');
  const [tmpToken, setTmpToken] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState('');
  const [issuedCodes, setIssuedCodes] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  async function onInit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !recoveryCode) return;
    try {
      const res = await initMut.mutateAsync({
        username: username.toLowerCase(),
        recovery_code: recoveryCode.trim(),
      });
      setTmpToken(res.tmp_token);
      setPhase('warn');
    } catch (err) {
      // Generic 401 — don't leak whether username exists
      toast({
        title: 'Kurtarma başlatılamadı',
        description: 'Kullanıcı adı veya recovery code hatalı.',
        variant: 'destructive',
      });
      // Keep err visible in console for ops debugging
      console.warn('recover init failed:', err);
    }
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 12) {
      toast({
        title: 'Parola çok kısa',
        description: 'Yeni master parola en az 12 karakter olmalı.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast({
        title: 'Parolalar eşleşmiyor',
        description: 'Onay alanı master parolayla aynı olmalı.',
        variant: 'destructive',
      });
      return;
    }

    setBusy(true);
    try {
      // 1. Yeni keypair (X25519). Eski item_shares wrap'lı erişim kaybedilir.
      const { publicKey, privateKey } = await generateX25519Keypair();
      // 2. Yeni KEK
      const kekSalt = randomKEKSalt();
      const kekParams = DEFAULT_KEK_PARAMS;
      const kek = await deriveKEK(newPassword, kekSalt, kekParams);
      // 3. Yeni priv'i KEK ile encrypt
      const privateKeyEnc = await encryptPrivateKey(privateKey, kek);

      const res = await completeMut.mutateAsync({
        tmpToken,
        body: {
          new_master_password: newPassword,
          public_key: toBase64(publicKey),
          new_private_key_enc: toBase64(privateKeyEnc),
          new_kek_salt: toBase64(kekSalt),
          new_kek_params: { ...kekParams, salt_b64: toBase64(kekSalt) },
        },
      });

      // Belleği temizle
      kek.fill(0);
      privateKey.fill(0);

      setIssuedCodes(res.recovery_codes);
      setPhase('codes');
    } catch (err) {
      toast({
        title: 'Kurtarma tamamlanamadı',
        description: err instanceof Error ? err.message : 'Bilinmeyen hata.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  function onConfirmSavedCodes() {
    toast({
      title: 'Hesap kurtarıldı',
      description: 'Yeni parolanızla giriş yapabilirsiniz.',
    });
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Hesap Kurtarma</CardTitle>
          <CardDescription>
            {phase === 'init' && 'Recovery code ile yeni master parola atayın.'}
            {phase === 'warn' && 'Devam etmeden önce dikkat.'}
            {phase === 'complete' && 'Yeni master parola ve onay.'}
            {phase === 'codes' && 'Yeni recovery codeları kaydedin.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phase === 'init' && (
            <form onSubmit={onInit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Kullanıcı Adı</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Recovery Code</Label>
                <Input
                  id="code"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="16 karakter hex"
                  required
                />
              </div>
              <Button type="submit" disabled={initMut.isPending}>
                {initMut.isPending ? 'Doğrulanıyor...' : 'Devam'}
              </Button>
            </form>
          )}

          {phase === 'warn' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm">
                <p className="font-semibold text-destructive">
                  ⚠ Önemli: Eski şifrelenmiş paylaşımlar erişilemez olacak
                </p>
                <p className="mt-2 text-muted-foreground">
                  Hesabınız yeni bir anahtar çiftiyle yeniden kurulacak. Başka kullanıcılar size
                  paylaşmış oldukları item'lara erişiminiz kaybedilir — sahibinden yeniden paylaşım
                  istemeniz gerekecek. Kendi item'larınızdaki şifreli alanlar da kurtarılamaz.
                </p>
              </div>
              <Button variant="destructive" onClick={() => setPhase('complete')}>
                Anladım, devam et
              </Button>
              <Button variant="outline" onClick={() => navigate('/login')}>
                Vazgeç
              </Button>
            </div>
          )}

          {phase === 'complete' && (
            <form onSubmit={onComplete} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newpw">Yeni Master Parola (≥12 karakter)</Label>
                <Input
                  id="newpw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newpw2">Onay</Label>
                <Input
                  id="newpw2"
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Yeni anahtar üretiliyor...' : 'Hesabı kurtar'}
              </Button>
            </form>
          )}

          {phase === 'codes' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
                <p className="text-sm font-semibold text-destructive">
                  Bu kodlar SADECE bir kez gösterilir.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Önceki recovery code'ları artık geçersiz. Bu yenilerini güvenli bir yere kaydedin.
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-4 font-mono text-sm">
                {issuedCodes.map((c) => (
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
