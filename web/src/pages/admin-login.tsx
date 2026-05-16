/**
 * Admin Login page — /admin-login
 *
 * TOTP-free login for the bootstrap admin account.
 * Only accepts users with the 'admin' role.
 *
 * Flow:
 *   1. On mount → GET /bootstrap/status
 *   2. setup_complete=false → navigate('/admin-setup')  (admin not created yet)
 *   3. setup_complete=true  → show login form
 *   4. Submit → POST /bootstrap/login → on success → navigate('/admin/users')
 *
 * ADR-0010: TOTP-free path, intentional.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Loader2 } from 'lucide-react';
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

  // On mount: verify admin has been set up; if not, send to setup
  React.useEffect(() => {
    bootstrapStatus()
      .then(({ setup_complete }) => {
        if (!setup_complete) {
          navigate('/admin-setup', { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        // Bootstrap disabled or server error — show form, server will reject.
        setChecking(false);
      });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (!username || !password) {
      toast({ title: 'Eksik alan', description: 'Kullanıcı adı ve şifre zorunlu.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await bootstrapLogin(username.toLowerCase().trim(), password);

      setBootstrapSession({
        user: { id: res.user_id, username: username.toLowerCase().trim(), roles: res.roles },
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        mustChangePassword: res.must_change_password,
      });

      // MustChangePasswordGate handles the redirect if must_change_password=true
      navigate('/admin/users', { replace: true });
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 gap-4">
      {/* Warning banner */}
      <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">Bootstrap Modu</p>
          <p className="text-xs mt-0.5 opacity-80">
            TOTP atlanıyor. İşiniz bitince çıkış yapın ve{' '}
            <code className="font-mono">ENVANTER_BOOTSTRAP_ENABLED=false</code> yapın.
          </p>
        </div>
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
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Giriş yapılıyor…</>
              ) : (
                'Giriş Yap'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
