/**
 * Login placeholder — actual implementation lands in PR-W2 (Win).
 *
 * PR-W2 will:
 *   1. Render the {username, master_password, totp_code} form
 *   2. POST /auth/login -> {access_token, refresh_token, user}
 *   3. GET /users/me/keypair -> {public_key, private_key_enc, kek_*}
 *   4. argon2id(master_password, kek_salt, kek_params) -> KEK
 *   5. AES-GCM-decrypt(private_key_enc, KEK) -> private_key
 *   6. authStore.setSession({ user, accessToken, refreshToken, kek, privateKey })
 *   7. navigate(from || '/inventory')
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Envanter Girişi</CardTitle>
          <CardDescription>PR-W2 sırasında gerçek form gelecek.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Foundation çalışıyor. Login akışı (Argon2id KEK türetme + keypair fetch + authStore
            session) bir sonraki PR ile aktif olacak.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
