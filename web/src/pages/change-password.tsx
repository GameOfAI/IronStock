/**
 * Zorunlu şifre değiştirme sayfası.
 *
 * Tetiklenme: admin tarafından oluşturulan veya ilk kurulumda seed edilen
 * kullanıcılar ilk girişlerinde buraya yönlendirilir (must_change_password=true).
 *
 * Akış:
 *   1. Mevcut (geçici) şifre + yeni şifre + onay al.
 *   2. Yeni KEK türet (Argon2id, yeni kek_salt).
 *   3. Mevcut privateKey'i yeni KEK ile yeniden wrap et.
 *   4. POST /auth/change-password → must_change_password = false.
 *   5. Bootstrap kullanıcılar için localStorage'dan geçici anahtarı sil.
 *   6. Tüm oturumları kapat → /login yönlendir (yeni şifreyle giriş).
 *
 * NOT: placeholder keypair (alg:none) olan kullanıcılar bu sayfa üzerinden
 * gerçek Argon2id KEK'e geçer. public_key güncelleme (keypair rotation) ayrı
 * bir PR'a bırakıldı; şimdilik sıfır-baytlı public_key kabul edilebilir.
 */

import * as React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useChangePasswordMutation } from '@/api/auth';
import { useAuthStore } from '@/store/auth';
import {
  DEFAULT_KEK_PARAMS,
  deriveKEK,
  encryptPrivateKey,
  randomKEKSalt,
  toBase64,
} from '@/lib/crypto';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function ChangePasswordPage() {
  useDocumentTitle('Şifre Değiştir');
  const navigate = useNavigate();
  const { toast } = useToast();

  const privateKey = useAuthStore((s) => s.privateKey);
  const user = useAuthStore((s) => s.user);
  const isBootstrap = useAuthStore((s) => s.isBootstrap);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const clear = useAuthStore((s) => s.clear);

  // All hooks must be called unconditionally before any early return.
  const mut = useChangePasswordMutation();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Render-time guard: if the user navigates here directly (mustChangePassword=false),
  // bounce to /inventory. This cannot fire during the clear() transition because
  // AuthGate unmounts us before we re-render (isAuthed=false → AuthGate returns <Navigate>).
  if (!mustChangePassword) {
    return <Navigate to="/inventory" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (!privateKey) {
      toast({
        title: 'Oturum hatası',
        description: 'Anahtar bulunamadı. Lütfen tekrar giriş yapın.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 12) {
      toast({
        title: 'Parola çok kısa',
        description: 'Yeni parola en az 12 karakter olmalı.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      toast({
        title: 'Parolalar eşleşmiyor',
        description: 'Yeni parola ile onay alanı aynı olmalı.',
        variant: 'destructive',
      });
      return;
    }

    if (currentPassword === newPassword) {
      toast({
        title: 'Aynı parola',
        description: 'Yeni parola mevcut paroladan farklı olmalı.',
        variant: 'destructive',
      });
      return;
    }

    setBusy(true);
    try {
      // Yeni KEK türet (gerçek Argon2id — placeholder alg:none'dan yükseltiyor olabilir)
      const kekSalt = randomKEKSalt();
      const kekParams = DEFAULT_KEK_PARAMS;
      const newKEK = await deriveKEK(newPassword, kekSalt, kekParams);

      // Mevcut privateKey'i yeni KEK ile şifrele
      const newPrivateKeyEnc = await encryptPrivateKey(privateKey, newKEK);
      newKEK.fill(0); // geçici KEK'i sil

      await mut.mutateAsync({
        current_master_password: currentPassword,
        new_master_password: newPassword,
        new_private_key_enc: toBase64(newPrivateKeyEnc),
        new_kek_salt: toBase64(kekSalt),
        new_kek_params: { ...kekParams, salt_b64: toBase64(kekSalt) },
      });

      // Bootstrap kullanıcılar için geçici localStorage anahtarını temizle
      if (isBootstrap && user) {
        localStorage.removeItem(`envanter-bootstrap-pk:${user.id}`);
      }

      toast({
        title: 'Parola değiştirildi',
        description: 'Yeni parolanızla tekrar giriş yapın.',
      });

      // Tüm oturumları kapat (server revoke etti)
      clear();
      navigate('/login', { replace: true });
    } catch (err) {
      toast({
        title: 'Parola değiştirilemedi',
        description: err instanceof Error ? err.message : 'Bilinmeyen hata.',
        variant: 'destructive',
      });
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Şifre Değişikliği Gerekli</CardTitle>
          <CardDescription>
            Bu hesabın ilk girişinde şifre değişikliği zorunludur. Yeni bir
            master parola belirleyin. Değişiklik sonrası tüm oturumlar
            kapatılır ve yeni parolayla giriş yapmanız gerekir.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cur">Mevcut Parola</Label>
              <Input
                id="cur"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new">Yeni Parola (en az 12 karakter)</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={12}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new2">Yeni Parola (Onay)</Label>
              <Input
                id="new2"
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={12}
                disabled={busy}
              />
            </div>

            <Button type="submit" disabled={busy} className="mt-2">
              {busy ? 'İşleniyor...' : 'Parolayı Değiştir'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
