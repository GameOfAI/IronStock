import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/api/query';
import { useAuthStore } from '@/store/auth';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { AuthGate } from '@/routes/auth-gate';
import { ConnectionGate } from '@/routes/connection-gate';

import ConfigPage from '@/pages/config';
import LoginPage from '@/pages/login';
import InventoryPage from '@/pages/inventory';
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

/**
 * Uygulama açılışında refresh token ile session hydration.
 * PR-C3'te gerçek silent-refresh denemeleri buraya eklenir.
 */
function HydrateBoot() {
  const setHydrating = useAuthStore((s) => s.setHydrating);
  React.useEffect(() => {
    setHydrating(false);
  }, [setHydrating]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthEventBridge />
          <HydrateBoot />
          <Routes>
            {/* Sunucu yapılandırma ekranı — ConnectionGate'den önce, her zaman erişilebilir */}
            <Route path="/config" element={<ConfigPage />} />

            {/* Sunucu adresi ayarlanmamışsa /config'e yönlendir */}
            <Route element={<ConnectionGate />}>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />

              {/* Authenticated */}
              <Route element={<AuthGate />}>
                <Route element={<AppShell />}>
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
