import * as React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { queryClient } from '@/api/query';
import { useAuthStore } from '@/store/auth';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { AuthGate, MustChangePasswordGate, RoleGate } from '@/routes/auth-gate';
import { WsProvider } from '@/components/ws-provider';

import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import TOTPSetupPage from '@/pages/totp-setup';
import RecoverPage from '@/pages/recover';
import InventoryPage from '@/pages/inventory';
import AdminUsersPage, { AdminAuditLogPage } from '@/pages/admin';
import AdminRolesPage from '@/pages/admin/roles';
import AdminGroupsPage from '@/pages/admin/groups';
import TagsPage from '@/pages/tags';
import { GraphPage } from '@/pages/graph';
import AdminSetupPage from '@/pages/admin-setup';
import AdminLoginPage from '@/pages/admin-login';
import ChangePasswordPage from '@/pages/change-password';
import ProfilePage from '@/pages/profile';
import SharePage from '@/pages/share';
import NotFoundPage from '@/pages/not-found';

/**
 * Listens for the 'auth:logout' custom event the API client emits when
 * refresh fails / reuse is detected. Clears the auth store and bounces
 * the user to /login.
 *
 * Mounted once at the router root so the navigate() call has access to
 * react-router context.
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
 * Boot-time hydration. Marks the auth store as "no longer hydrating"
 * after first paint. PR-W2 will refine this: try GET /users/me/keypair
 * with the persisted refresh token to silently restore session.
 */
function HydrateBoot() {
  const setHydrating = useAuthStore((s) => s.setHydrating);
  React.useEffect(() => {
    // PR-W2 will replace this with a real silent-refresh attempt.
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
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/totp/setup" element={<TOTPSetupPage />} />
            <Route path="/recover" element={<RecoverPage />} />
            {/* Bootstrap admin panel — TOTP-free, ADR-0010 */}
            <Route path="/admin-setup" element={<AdminSetupPage />} />
            <Route path="/admin-login" element={<AdminLoginPage />} />
            {/* PR-N5: Public one-time share link — no auth required */}
            <Route path="/share/:token" element={<SharePage />} />

            {/* Authenticated — WsProvider starts WebSocket after login */}
            <Route element={<AuthGate />}>
              {/* Zorunlu şifre değiştirme — MustChangePasswordGate'ten önce erişilebilir */}
              <Route path="/change-password" element={<ChangePasswordPage />} />

              {/* MustChangePasswordGate: must_change_password=true ise /change-password'e yönlendirir */}
              <Route element={<MustChangePasswordGate />}>
                <Route element={<WsProvider><Outlet /></WsProvider>}>
                <Route element={<AppShell />}>
                  <Route index element={<Navigate to="/inventory" replace />} />
                  <Route path="/inventory/*" element={<InventoryPage />} />
                  <Route path="/tags" element={<TagsPage />} />
                  <Route path="/graph" element={<GraphPage />} />
                  <Route path="/profile" element={<ProfilePage />} />

                  {/* Admin */}
                  <Route element={<RoleGate role="admin" />}>
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/roles" element={<AdminRolesPage />} />
                    <Route path="/admin/groups" element={<AdminGroupsPage />} />
                    <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
                  </Route>
                </Route>
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
