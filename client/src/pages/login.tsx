/**
 * LoginPage — placeholder.
 * İçerik PR-C3'te (client-auth) doldurulacak.
 */

import { Lock } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="flex h-screen items-center justify-center bg-muted/20">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Lock className="h-10 w-10" />
        <p className="text-sm">Login ekranı — PR-C3 (client-auth) ile gelecek.</p>
      </div>
    </div>
  );
}
