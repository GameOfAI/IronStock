/**
 * Reset Password — POST /api/v1/auth/reset-password
 *
 * Token URL'den alınır (?token=...).
 *
 * KRİTİK GÜVENLİK UYARISI:
 * Şifre sıfırlama, mevcut E2E private key'i geçersiz kılar. Daha önce size
 * paylaşılmış olan tüm öğelere erişim kalıcı olarak KAYBOLUR.
 * Recovery code varsa /recover sayfası kullanılmalıdır.
 *
 * Akış:
 *   1. Warn phase: büyük amber uyarı banner
 *   2. Complete phase: yeni şifre + yeni E2E keypair üretimi
 *   3. Done phase: başarı + login yönlendirmesi
 */

import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff, Key, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useResetPasswordMutation } from '@/api/auth';
import {
  DEFAULT_KEK_PARAMS,
  deriveKEK,
  encryptPrivateKey,
  generateX25519Keypair,
  randomKEKSalt,
  toBase64,
} from '@/lib/crypto';

type Phase = 'warn' | 'complete' | 'done';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const mutation = useResetPasswordMutation();

  const token = searchParams.get('token') ?? '';

  const [phase, setPhase] = React.useState<Phase>('warn');
  const [newPassword, setNewPassword] = React.useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Token yoksa erken çık
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
          <CardContent className="pt-6">
            <div className="rounded-lg border border-red-700 bg-red-950/40 p-4 text-sm text-red-300">
              Geçersiz veya eksik sıfırlama tokeni. Lütfen e-postanızdaki bağlantıyı kullanın.
            </div>
            <Link to="/login">
              <Button variant="outline" className="mt-4 w-full border-zinc-700 text-zinc-300">
                Giriş sayfasına dön
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 12) {
      toast({
        title: 'Şifre çok kısa',
        description: 'Yeni şifre en az 12 karakter olmalıdır.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast({
        title: 'Şifreler eşleşmiyor',
        description: 'Şifre ve onay alanı aynı olmalıdır.',
        variant: 'destructive',
      });
      return;
    }

    setBusy(true);
    try {
      // 1. Yeni E2E keypair üret (X25519)
      const { publicKey, privateKey } = await generateX25519Keypair();

      // 2. Yeni KEK türet
      const kekSalt = randomKEKSalt();
      const kekParams = DEFAULT_KEK_PARAMS;
      const kek = await deriveKEK(newPassword, kekSalt, kekParams);

      // 3. Private key'i yeni KEK ile şifrele
      const privateKeyEnc = await encryptPrivateKey(privateKey, kek);

      await mutation.mutateAsync({
        token,
        new_password: newPassword,
        public_key: publicKey,
        private_key_enc: privateKeyEnc,
        kek_salt: kekSalt,
        kek_params: { ...kekParams, salt_b64: toBase64(kekSalt) },
      });

      // Belleği temizle
      kek.fill(0);
      privateKey.fill(0);

      setPhase('done');
    } catch (err) {
      toast({
        title: 'Şifre sıfırlanamadı',
        description:
          err instanceof Error
            ? err.message
            : 'Token geçersiz veya süresi dolmuş olabilir.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="rounded-full bg-indigo-600/10 p-2">
              <Key className="h-5 w-5 text-indigo-400" />
            </div>
            <CardTitle className="text-xl text-zinc-100">Şifre Sıfırlama</CardTitle>
          </div>
          <CardDescription className="text-zinc-400">
            {phase === 'warn' && 'Devam etmeden önce önemli bir uyarı okuyun.'}
            {phase === 'complete' && 'Yeni şifrenizi belirleyin.'}
            {phase === 'done' && 'Şifreniz başarıyla sıfırlandı.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ------------------------------------------------------------------ */}
          {/* Phase: warn — büyük amber uyarı */}
          {/* ------------------------------------------------------------------ */}
          {phase === 'warn' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-600 bg-amber-950/40 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
                  <div className="space-y-2">
                    <p className="font-semibold text-amber-300">
                      Kritik Güvenlik Uyarısı
                    </p>
                    <p className="text-sm text-amber-200">
                      Şifre sıfırlama işlemi, E2E şifreleme anahtarınızı tamamen değiştirir.
                      Bunun sonucunda:
                    </p>
                    <ul className="ml-4 list-disc space-y-1 text-sm text-amber-200">
                      <li>Size paylaşılmış tüm öğelere erişiminiz kalıcı olarak kaybolur</li>
                      <li>Paylaşılan öğelerin sahipleri sizi yeniden davet etmek zorunda kalır</li>
                      <li>Tüm aktif oturumlarınız sonlandırılır</li>
                    </ul>
                    <p className="mt-2 text-sm font-medium text-amber-300">
                      Recovery code'unuz varsa, bu sayfayı kapatıp{' '}
                      <Link to="/recover" className="underline hover:text-amber-100">
                        Recovery sayfasını
                      </Link>{' '}
                      kullanın — bu yöntem item paylaşımlarını korur.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => setPhase('complete')}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white"
              >
                Anlıyorum, yine de devam et
              </Button>

              <Link to="/recover">
                <Button variant="outline" className="w-full border-zinc-700 text-zinc-300">
                  Recovery code ile kurtar (önerilen)
                </Button>
              </Link>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Phase: complete — yeni şifre formu */}
          {/* ------------------------------------------------------------------ */}
          {phase === 'complete' && (
            <form onSubmit={handleReset} className="space-y-4">
              {/* Küçük amber reminder */}
              <div className="rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Paylaşılan öğelere erişim kaybolacak. Bu işlem geri alınamaz.
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-zinc-300">
                  Yeni Şifre
                </Label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={12}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 pr-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="En az 12 karakter"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-zinc-300">
                  Şifre Onay
                </Label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  required
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Şifreyi tekrar girin"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500"
                disabled={busy || !newPassword || !newPasswordConfirm}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Anahtar üretiliyor...
                  </>
                ) : (
                  'Şifremi Sıfırla'
                )}
              </Button>
            </form>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Phase: done — başarı */}
          {/* ------------------------------------------------------------------ */}
          {phase === 'done' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="font-medium">Şifre başarıyla sıfırlandı</span>
                </div>
                <p className="mt-2 text-sm text-emerald-200">
                  Yeni şifrenizle giriş yapabilirsiniz. Tüm eski oturumlarınız sonlandırıldı.
                </p>
              </div>

              <Button
                onClick={() => navigate('/login', { replace: true })}
                className="w-full bg-indigo-600 hover:bg-indigo-500"
              >
                Giriş Sayfasına Git
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
