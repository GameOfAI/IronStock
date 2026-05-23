/**
 * Forgot Password — POST /api/v1/auth/forgot-password
 *
 * Kullanıcı e-postasını girer → her zaman generic mesaj gösterilir
 * (email enumeration koruması).
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useForgotPasswordMutation } from '@/api/auth';

export default function ForgotPasswordPage() {
  const mutation = useForgotPasswordMutation();
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    mutation.mutate(
      { email: email.trim().toLowerCase() },
      {
        onSettled: () => {
          // Her zaman başarı mesajı göster (enumeration koruması)
          setSent(true);
        },
        onError: () => {
          // Hata durumunda da aynı mesajı göster
          setSent(true);
        },
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader className="space-y-1">
          <div className="mb-2 flex items-center gap-2">
            <div className="rounded-full bg-indigo-600/10 p-2">
              <Mail className="h-5 w-5 text-indigo-400" />
            </div>
            <CardTitle className="text-xl text-zinc-100">Şifremi Unuttum</CardTitle>
          </div>
          <CardDescription className="text-zinc-400">
            {sent
              ? 'E-posta gönderildi'
              : 'Kayıtlı e-posta adresinizi girin. Şifre sıfırlama bağlantısı göndereceğiz.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4 text-sm text-emerald-300">
                Eğer bu e-posta adresi sistemimizde kayıtlıysa, şifre sıfırlama bağlantısı
                içeren bir e-posta gönderildi. Lütfen gelen kutunuzu kontrol edin.
              </div>
              <p className="text-xs text-zinc-500">
                E-posta gelmedi mi? Spam klasörünüzü kontrol edin ya da birkaç dakika bekleyin.
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full border-zinc-700 text-zinc-300">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Giriş sayfasına dön
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300">
                  E-posta adresi
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kullanici@sirket.com"
                  required
                  autoFocus
                  className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500"
                disabled={mutation.isPending || !email.trim()}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Gönderiliyor...
                  </>
                ) : (
                  'Sıfırlama Bağlantısı Gönder'
                )}
              </Button>

              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  <ArrowLeft className="mr-1 inline h-3 w-3" />
                  Giriş sayfasına dön
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
