/**
 * Change Password dialog.
 *
 * UX: triggered from a Settings menu in AppShell (lock icon next to user
 * menu — Faz 3 polish PR'ında ekleyeceğim button). For now the dialog
 * exposes itself via `<ChangePasswordDialog open onOpenChange/>`.
 *
 * Flow (preserves item_shares — public_key STAYS THE SAME):
 *   1. Validate current + new password (>=12, match confirm)
 *   2. Decrypt store-held privateKey is NOT possible (we only have it
 *      already in memory!). So:
 *        - Re-encrypt the in-memory privateKey with a fresh KEK.
 *   3. Generate fresh kek_salt + use default kek_params.
 *   4. deriveKEK(new_password, new_kek_salt) → new_kek
 *   5. encryptPrivateKey(privateKey, new_kek) → new_private_key_enc
 *   6. POST /auth/change-password with new_password + new wrap material
 *   7. authStore.clear() — server revoked all sessions; user re-logs in.
 *      (Keep KEK/priv in memory until 7? Server logs us out anyway.)
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const privateKey = useAuthStore((s) => s.privateKey);
  const clear = useAuthStore((s) => s.clear);
  const mut = useChangePasswordMutation();

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setBusy(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!privateKey) {
      toast({
        title: 'Oturum kapalı',
        description: 'Önce giriş yapmalısınız.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword.length < 12) {
      toast({ title: 'Parola çok kısa', description: 'En az 12 karakter.' });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast({
        title: 'Onay eşleşmiyor',
        description: 'Yeni parola ile onay alanı aynı olmalı.',
        variant: 'destructive',
      });
      return;
    }
    if (currentPassword === newPassword) {
      toast({
        title: 'Aynı parola',
        description: 'Yeni parola eskisinden farklı olmalı.',
      });
      return;
    }

    setBusy(true);
    try {
      // 1. Yeni KEK türet (yeni salt + same params)
      const kekSalt = randomKEKSalt();
      const kekParams = DEFAULT_KEK_PARAMS;
      const newKEK = await deriveKEK(newPassword, kekSalt, kekParams);

      // 2. Mevcut priv'i yeni KEK ile yeniden wrap (public_key SABIT —
      //    item_shares korunur).
      const newPrivateKeyEnc = await encryptPrivateKey(privateKey, newKEK);

      // 3. Submit
      await mut.mutateAsync({
        current_master_password: currentPassword,
        new_master_password: newPassword,
        new_private_key_enc: toBase64(newPrivateKeyEnc),
        new_kek_salt: toBase64(kekSalt),
        new_kek_params: { ...kekParams, salt_b64: toBase64(kekSalt) },
      });

      newKEK.fill(0); // wipe transient

      toast({
        title: 'Parola değiştirildi',
        description: 'Tüm oturumlar kapatıldı, yeni parolayla giriş yapın.',
      });
      onOpenChange(false);
      reset();
      // Server revoked all sessions including ours.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Master Parolayı Değiştir</DialogTitle>
          <DialogDescription>
            Yeni parolaya geçildiğinde tüm cihazlardaki oturumlar kapatılır. Tekrar giriş yapmanız
            gerekecek.
          </DialogDescription>
        </DialogHeader>

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
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new">Yeni Parola (≥12)</Label>
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
            <Label htmlFor="new2">Onay</Label>
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              İptal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'İşleniyor...' : 'Değiştir'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
