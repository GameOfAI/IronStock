import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

export default function RegisterPage() {
  useDocumentTitle('Kayıt');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password || password.length < 12) {
      toast({
        title: 'Eksik alan',
        description: 'Kullanıcı adı ve 12+ karakter şifre gerekli.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.toLowerCase(),
          email: `${username}@test.local`,
          master_password: password,
          public_key: Array.from(crypto.getRandomValues(new Uint8Array(32))),
          private_key_enc: Array.from(crypto.getRandomValues(new Uint8Array(64))),
          kek_salt: Array.from(crypto.getRandomValues(new Uint8Array(16))),
          kek_params: { alg: 'pbkdf2-sha256', iterations: 210000 },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Kayıt başarısız');
      }

      toast({
        title: 'Başarılı!',
        description: 'Kayıt tamam. Giriş sayfasına yönlendiriliyorsunuz...',
      });
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      toast({
        title: 'Hata',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Kayıt Ol</CardTitle>
          <CardDescription>Yeni hesap oluştur</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="username">Kullanıcı Adı</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Şifre (min 12 karakter)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? 'Kaydediliyor...' : 'Kayıt Ol'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
