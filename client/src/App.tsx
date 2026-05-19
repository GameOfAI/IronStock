import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/api/query';
import { useAuthStore } from '@/store/auth';
import { useConnectionStore } from '@/store/connection';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { AuthGate } from '@/routes/auth-gate';
import { ConnectionGate } from '@/routes/connection-gate';
import { useInactivityLock } from '@/hooks/use-inactivity-lock';
import { WsProvider } from '@/components/ws-provider';
import { getRefreshToken, setAccessToken, setRefreshToken } from '@/api/token-storage';
import { rawFetch } from '@/api/client';
import { kekLoad } from '@/lib/tauri';
import { fetchMe, fetchMyKeypair } from '@/api/me';
import { decryptPrivateKey, fromBase64 } from '@/lib/crypto';

import ConfigPage from '@/pages/config';
import LoginPage from '@/pages/login';
import TOTPSetupPage from '@/pages/totp-setup';
import InventoryPage from '@/pages/inventory';
import AdminSetupPage from '@/pages/admin-setup';
import AdminLoginPage from '@/pages/admin-login';
import NotFoundPage from '@/pages/not-found';

/**
 * auth:logout custom event'i dinler — api/client.ts refresh başarısız olduğunda
 * dispatch edilir. Auth store temizlenip /login'e yönlendirilir.
 */
function AuthEventBridge() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);

  React.useEffect(() => {
    const handler = () => {
      clear();
      navigate('/login', { replace: true });
    };
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, [clear, navigate]);

  return null;
}

const LAST_USERNAME_KEY = 'envanter.last_username';

/**
 * Uygulama açılışında sessiz oturum yenileme (PR-F3 KeyringBootstrap).
 *
 * Akış:
 *   1. serverUrl + refreshToken + lastUsername var mı?
 *   2. POST /auth/refresh → yeni access token
 *   3. OS keyring'den KEK yükle (Tauri: Windows Credential Manager / macOS Keychain)
 *   4. KEK yoksa → login gerekli
 *   5. GET /users/me + GET /users/me/keypair → kullanıcı bilgisi + şifreli private key
 *   6. AES-GCM(KEK) ile private key çöz → setSession()
 *   7. Herhangi bir adım başarısız → sessizce login ekranına düş
 */
function KeyringBootstrap() {
  const setSession = useAuthStore((s) => s.setSession);
  const setHydrating = useAuthStore((s) => s.setHydrating);
  const serverUrl = useConnectionStore((s) => s.serverUrl);

  React.useEffect(() => {
    let cancelled = false;

    async function tryBootstrap() {
      try {
        // Sunucu URL'i veya refresh token yoksa direkt login ekranına düş
        if (!serverUrl) { setHydrating(false); return; }
        const storedRefresh = getRefreshToken();
        if (!storedRefresh) { setHydrating(false); return; }
        const lastUsername = localStorage.getItem(LAST_USERNAME_KEY);
        if (!lastUsername) { setHydrating(false); return; }

        // JWT token yenile (rawFetch: TLS skip-verify aware)
        const refreshRes = await rawFetch(`${serverUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: storedRefresh }),
        });
        if (!refreshRes.ok) { if (!cancelled) setHydrating(false); return; }
        const refreshBody = (await refreshRes.json()) as { access_token: string; refresh_token: string };
        const accessToken = refreshBody.access_token;
        setAccessToken(accessToken);
        setRefreshToken(refreshBody.refresh_token);

        // KEK'i OS keyring'den yükle (Tauri dışında null döner → login gerekli)
        const kekBase64 = await kekLoad(lastUsername);
        if (!kekBase64) { if (!cancelled) setHydrating(false); return; }

        // base64 → Uint8Array
        const kekBin = atob(kekBase64);
        const kek = new Uint8Array(kekBin.length);
        for (let i = 0; i < kekBin.length; i++) kek[i] = kekBin.charCodeAt(i);

        // Kullanıcı profili + keypair çek
        const [me, keypair] = await Promise.all([
          fetchMe(accessToken),
          fetchMyKeypair(accessToken),
        ]);

        // Private key şifresini çöz
        const privateKeyEnc = fromBase64(keypair.private_key_enc);
        const privateKey = await decryptPrivateKey(privateKeyEnc, kek);

        if (cancelled) return;

        // Oturumu yeniden kur — kullanıcı login ekranı görmeden devam eder
        setSession({
          user: { id: me.id, username: me.username, roles: me.roles },
          accessToken,
          refreshToken: refreshBody.refresh_token,
          kek,
          privateKey,
        });
      } catch {
        // Sessiz hata — kullanıcı login ekranını görür
        if (!cancelled) setHydrating(false);
      }
    }

    tryBootstrap();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** 10 dakika hareketsizlikte session'ı kilitler. */
function InactivityGuard() {
  useInactivityLock();
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthEventBridge />
          <KeyringBootstrap />
          <InactivityGuard />
          <Routes>
            {/* Sunucu yapılandırma ekranı — ConnectionGate'den önce, her zaman erişilebilir */}
            <Route path="/config" element={<ConfigPage />} />

            {/* Sunucu adresi ayarlanmamışsa /config'e yönlendir */}
            <Route element={<ConnectionGate />}>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/totp/setup" element={<TOTPSetupPage />} />
              {/* Bootstrap admin (TOTP-free) — ADR-0010 */}
              <Route path="/admin-setup" element={<AdminSetupPage />} />
              <Route path="/admin-login" element={<AdminLoginPage />} />

              {/* Authenticated */}
              <Route element={<AuthGate />}>
                <Route element={<WsProvider><AppShell /></WsProvider>}>
                  <Route index element={<Navigate to="/inventory" replace />} />
                  <Route path="/inventory/*" element={<InventoryPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
