/**
 * CreateUserModal — admin tarafından yeni kullanıcı oluşturma modalı.
 *
 * POST /api/v1/admin/users çağırır. Kullanıcı placeholder keypair ile
 * oluşturulur (bootstrap admin gibi); E2E kripto gerektirmez.
 */

import * as React from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useCreateUserMutation } from '@/api/admin';
import { ApiError } from '@/api/errors';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Tam yönetim yetkisi' },
  { value: 'write', label: 'Yazma', description: 'Envanter oluşturma ve düzenleme' },
  { value: 'read', label: 'Okuma', description: 'Sadece görüntüleme' },
];

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateUserModal({ open, onClose }: CreateUserModalProps) {
  const { toast } = useToast();
  const createMutation = useCreateUserMutation();

  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>(['read']);

  const busy = createMutation.isPending;

  function resetForm() {
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setSelectedRoles(['read']);
  }

  function handleClose() {
    if (busy) return;
    resetForm();
    onClose();
  }

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (password !== confirmPassword) {
      toast({ title: 'Şifreler eşleşmiyor', variant: 'destructive' });
      return;
    }
    if (selectedRoles.length === 0) {
      toast({ title: 'En az bir rol seçiniz', variant: 'destructive' });
      return;
    }

    try {
      await createMutation.mutateAsync({ username, email, password, roles: selectedRoles });
      toast({ title: 'Kullanıcı oluşturuldu', description: `@${username} başarıyla eklendi.` });
      resetForm();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Hata oluştu.';
      toast({ title: 'Kullanıcı oluşturulamadı', description: msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni Kullanıcı Oluştur</DialogTitle>
          <DialogDescription>
            Kullanıcı bilgilerini ve başlangıç rollerini belirleyin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-username">Kullanıcı Adı</Label>
            <Input
              id="cu-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="ornek.kullanici"
              autoComplete="off"
              required
              minLength={3}
              maxLength={64}
              pattern="[a-zA-Z0-9._\-]{3,64}"
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-email">E-posta</Label>
            <Input
              id="cu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kullanici@sirket.com"
              autoComplete="off"
              required
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-password">Şifre</Label>
            <Input
              id="cu-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="En az 12 karakter"
              required
              minLength={12}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-confirm">Şifre Tekrar</Label>
            <Input
              id="cu-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Şifreyi tekrar girin"
              required
              minLength={12}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Roller</Label>
            <div className="rounded-md border p-3 flex flex-col gap-2">
              {ROLES.map((role) => (
                <div key={role.value} className="flex items-center gap-3">
                  <Checkbox
                    id={`cu-role-${role.value}`}
                    checked={selectedRoles.includes(role.value)}
                    onCheckedChange={() => toggleRole(role.value)}
                    disabled={busy}
                  />
                  <div className="flex flex-col">
                    <label
                      htmlFor={`cu-role-${role.value}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {role.label}
                    </label>
                    <span className="text-xs text-muted-foreground">{role.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
              İptal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Oluşturuluyor...' : 'Kullanıcı Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
