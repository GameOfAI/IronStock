/**
 * Admin Setup — /admin-setup (Tauri client).
 *
 * One-time admin account creation. Mirrors web/src/pages/admin-setup.tsx
 * but uses the client's dynamic baseUrl (connection store).
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { bootstrapStatus, bootstrapSetup } from '@/api/bootstrap';
import { useAuthStore } from '@/store/auth';

export default function AdminSetupPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);

  const [checking, setChecking] = React.useState(true);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [passwordConfirm, setPasswordConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    bootstrapStatus()
      .then(({ setup_complete }) => {
        if (setup_complete) {
          navigate('/admin-login', { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (!username || !password) {
      toast({ title: 'Eksik alan', description: 'Tüm alanlar zorunlu.', variant: 'destructive' });
      return;
    }
    if (password !== passwordConfirm) {
      toast({ title: 'Şifreler eşleşmiyor', description: 'Lütfen şifreyi tekrar girin.', variant: 'destructive' });
      return;
    }
    if (password.length < 12) {
      toast({ title: 'Şifre çok kısa', description: 'En az 12 karakter gerekli.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await bootstrapSetup(username.toLowerCase().trim(), password);

      setBootstrapSession({
        user: { id: res.user_id, username: username.toLowerCase().trim(), roles: res.roles },
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
      });

      toast({ title: 'Admin hesabı oluşturuldu', description: 'Hoş geldiniz!' });
      navigate('/inventory', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hesap oluşturulamadı.';
      toast({ title: 'Hata', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Yükleniyor…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 gap-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Admin Hesabı Oluştur</CardTitle>
          <CardDescription>
            Bu ekran <strong>yalnızca bir kez</strong> kullanılabilir.
            Admin hesabı oluşturulduktan sonra bu sayfa erişime kapanır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-username">Kullanıcı Adı</Label>
              <Input
                id="setup-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="admin"
                required
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-password">Şifre</Label>
              <Input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="En az 12 karakter"
                required
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-password-confirm">Şifre (Tekrar)</Label>
              <Input
                id="setup-password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? 'Oluşturuluyor…' : 'Admin Hesabı Oluştur'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/login')}
              disabled={loading}
            >
              Normal girişe dön
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
