/**
 * Admin Login — /admin-login (Tauri client).
 *
 * TOTP-free login for the bootstrap admin. Mirrors web/src/pages/admin-login.tsx.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { bootstrapStatus, bootstrapLogin } from '@/api/bootstrap';
import { useAuthStore } from '@/store/auth';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);

  const [checking, setChecking] = React.useState(true);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    bootstrapStatus()
      .then(({ setup_complete }) => {
        if (!setup_complete) {
          navigate('/admin-setup', { replace: true });
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
      toast({
        title: 'Eksik alan',
        description: 'Kullanıcı adı ve şifre zorunlu.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const res = await bootstrapLogin(username.toLowerCase().trim(), password);

      setBootstrapSession({
        user: { id: res.user_id, username: username.toLowerCase().trim(), roles: res.roles },
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
      });

      navigate('/inventory', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Giriş başarısız.';
      toast({ title: 'Giriş başarısız', description: msg, variant: 'destructive' });
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
      <div className="w-full max-w-md rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700">
        <p className="font-semibold text-sm">Bootstrap Modu</p>
        <p className="text-xs mt-0.5 opacity-80">
          TOTP atlanıyor. İşiniz bitince çıkış yapın ve sunucuda{' '}
          <code className="font-mono">ENVANTER_BOOTSTRAP_ENABLED=false</code> yapın.
        </p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin Girişi</CardTitle>
          <CardDescription>
            Sadece <strong>admin</strong> rolündeki hesaplar giriş yapabilir. TOTP kodu gerekmez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-username">Kullanıcı Adı</Label>
              <Input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Şifre</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
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
