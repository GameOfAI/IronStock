/**
 * SSOCallbackPage — handles the OIDC redirect landing.
 *
 * After successful OIDC authentication the Go server redirects the browser to:
 *   /sso-callback#access_token=...&refresh_token=...&user_id=...&username=...&roles=[...]&expires_in=...
 *
 * Tokens are in the HASH fragment (not query params) so they are NOT sent to
 * the server in Referer headers. This page reads the fragment, sets the auth
 * store (using the bootstrap session path since SSO users don't have a local
 * KEK-derived keypair), and navigates to /inventory.
 *
 * On error (missing / malformed fragment) it shows a friendly message and a
 * link back to /login.
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Key, Loader2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import type { SessionUser } from '@/store/auth';
import { useDocumentTitle } from '@/hooks/use-document-title';

function parseHash(): {
  accessToken: string;
  refreshToken: string;
  userID: string;
  username: string;
  roles: string[];
} | null {
  const raw = window.location.hash.slice(1); // strip leading '#'
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const userID = params.get('user_id');
  const username = params.get('username');
  const rolesRaw = params.get('roles');

  if (!accessToken || !refreshToken || !userID || !username) return null;

  let roles: string[] = [];
  if (rolesRaw) {
    try {
      const parsed = JSON.parse(rolesRaw);
      if (Array.isArray(parsed)) roles = parsed as string[];
    } catch {
      // ignore — roles default to []
    }
  }

  return { accessToken, refreshToken, userID, username, roles };
}

export default function SSOCallbackPage() {
  useDocumentTitle('SSO Yönlendirme');
  const navigate = useNavigate();
  const setBootstrapSession = useAuthStore((s) => s.setBootstrapSession);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const parsed = parseHash();

    if (!parsed) {
      setError(
        'SSO oturumu başlatılamadı — eksik veya geçersiz token bilgisi. Lütfen tekrar deneyin.',
      );
      return;
    }

    const { accessToken, refreshToken, userID, username, roles } = parsed;

    const sessionUser: SessionUser = { id: userID, username, roles };

    // SSO users don't have a local master password → use bootstrap session.
    // Their private-key material is random and stored per-user in localStorage
    // so items they create remain readable across re-logins (see auth store).
    setBootstrapSession({
      user: sessionUser,
      accessToken,
      refreshToken,
      mustChangePassword: false,
      mustSetupTOTP: false,
    });

    // Clear the hash so tokens don't linger in browser history.
    history.replaceState(null, '', window.location.pathname);

    navigate('/inventory', { replace: true });
  }, [navigate, setBootstrapSession]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* Grid texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[120px]" />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 px-4 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
          <Key className="h-[22px] w-[22px] text-white" />
        </div>

        {error ? (
          <div className="w-full rounded-xl border border-red-800/50 bg-red-950/40 p-6 shadow-xl">
            <div className="mb-3 flex justify-center">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <h2 className="mb-1 text-[15px] font-semibold text-slate-100">SSO Girişi Başarısız</h2>
            <p className="mb-4 text-[13px] text-slate-400">{error}</p>
            <Link
              to="/login"
              className="inline-block rounded-md bg-slate-800 px-4 py-2 text-[13px] text-slate-200 hover:bg-slate-700"
            >
              ← Giriş sayfasına dön
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
            <p className="text-[13px] text-slate-400">SSO oturumu kuruluyor…</p>
          </div>
        )}
      </div>
    </div>
  );
}
