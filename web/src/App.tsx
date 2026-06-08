import * as React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { queryClient } from '@/api/query';
import { useAuthStore } from '@/store/auth';
import {
  getRefreshToken,
  getPersistedSession,
  setAccessToken as storeAccessToken,
  setRefreshToken as storeRefreshToken,
  clearAllTokens,
} from '@/api/token-storage';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { AuthGate, MustChangePasswordGate, MustSetupTOTPGate, RoleGate } from '@/routes/auth-gate';
import { WsProvider } from '@/components/ws-provider';
import { SkipLink } from '@/components/layout/skip-link';
import { ErrorBoundary } from '@/components/error-boundary';
import { OnboardingTour, useOnboardingTour } from '@/components/onboarding/onboarding-tour';
import { EntityPageRegistryProvider } from '@/lib/entity-page-registry';
import { DefaultTabsRegistrar } from '@/lib/default-entity-tabs';

import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import TOTPSetupPage from '@/pages/totp-setup';
import RecoverPage from '@/pages/recover';
import ForgotPasswordPage from '@/pages/forgot-password';
import ResetPasswordPage from '@/pages/reset-password';
import InventoryPage from '@/pages/inventory';
import AdminUsersPage, { AdminAuditLogPage, AdminDashboardPage } from '@/pages/admin';
import AdminClientCertsPage from '@/pages/admin/client-certs';
import AdminLogForwardingPage from '@/pages/admin/log-forwarding';
import AdminSSOPage from '@/pages/admin/sso';
import AdminSCIMPage from '@/pages/admin/scim';
import AdminSecretScanningPage from '@/pages/admin/secret-scanning';
import AdminK8sClustersPage from '@/pages/admin/k8s-clusters';
import AdminReportsPage from '@/pages/admin/reports';
import AdminPortalTemplatesPage from '@/pages/admin/portal-templates';
import SSOCallbackPage from '@/pages/sso-callback';
import TagsPage from '@/pages/tags';
import { GraphPage } from '@/pages/graph';
import PipelineListPage from '@/pages/pipeline/index';
import DiagramPage from '@/pages/pipeline/diagram';
import LifecyclePage from '@/pages/pipeline/lifecycle';
import AdminSetupPage from '@/pages/admin-setup';
import ChangePasswordPage from '@/pages/change-password';
import ProfilePage from '@/pages/profile';
import FavoritesPage from '@/pages/favorites';
import SharePage from '@/pages/share';
import ImportPage from '@/pages/import';
import AccessRequestsPage from '@/pages/access-requests';
import CatalogPage from '@/pages/catalog';
import EntityDetailPage from '@/pages/catalog/entity-detail';
import CreatePage from '@/pages/create';
import PortalHomePage from '@/pages/portal-home';
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
 * Boot-time hydration. Attempts to silently restore the session using
 * the persisted refresh token + user metadata from localStorage.
 *
 * Flow:
 *   1. Read refresh token + user session from localStorage.
 *   2. If both exist, POST /auth/refresh to get a fresh access token.
 *   3. Restore the auth store with user info + new access token.
 *   4. KEK/privateKey remain null (derived from master password at login)
 *      — features needing decryption will prompt for password.
 *   5. On any failure, fall through to the login screen.
 */
function HydrateBoot() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const setHydrating = useAuthStore((s) => s.setHydrating);

  React.useEffect(() => {
    let cancelled = false;

    const refreshToken = getRefreshToken();
    const session = getPersistedSession();

    if (!refreshToken || !session) {
      setHydrating(false);
      return;
    }

    fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then((res) => {
        if (!res.ok) {
          clearAllTokens();
          if (!cancelled) setHydrating(false);
          return null;
        }
        return res.json();
      })
      .then((body) => {
        if (!body || cancelled) return;
        storeAccessToken(body.access_token);
        storeRefreshToken(body.refresh_token);
        restoreSession({
          user: session.user,
          accessToken: body.access_token,
          mustChangePassword: session.mustChangePassword,
          mustSetupTOTP: session.mustSetupTOTP,
          isBootstrap: session.isBootstrap,
        });
      })
      .catch(() => {
        if (!cancelled) setHydrating(false);
      });

    return () => { cancelled = true; };
  }, [restoreSession, setHydrating]);

  return null;
}

function OnboardingTourBridge() {
  const { open, dismiss } = useOnboardingTour();
  return <OnboardingTour open={open} onDismiss={dismiss} />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <EntityPageRegistryProvider>
      <DefaultTabsRegistrar />
      <ThemeProvider>
        <BrowserRouter>
          <SkipLink />
          <AuthEventBridge />
          <HydrateBoot />
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/totp/setup" element={<TOTPSetupPage />} />
            <Route path="/recover" element={<RecoverPage />} />
            {/* PR-NOTIFY: Şifremi unuttum + sıfırlama */}
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Bootstrap admin panel — TOTP-free, ADR-0010 */}
            <Route path="/admin-setup" element={<AdminSetupPage />} />
            {/* PR-N5: Public one-time share link — no auth required */}
            <Route path="/share/:token" element={<SharePage />} />
            {/* PR-LDAP: OIDC callback landing — sets auth store from hash fragment */}
            <Route path="/sso-callback" element={<SSOCallbackPage />} />

            {/* Authenticated — WsProvider starts WebSocket after login */}
            <Route element={<AuthGate />}>
              {/* Zorunlu şifre değiştirme — her iki gate'ten önce erişilebilir */}
              <Route path="/change-password" element={<ChangePasswordPage />} />

              {/* MustChangePasswordGate: must_change_password=true ise /change-password'e yönlendirir */}
              <Route element={<MustChangePasswordGate />}>
                {/* PR-SEC2: TOTP gate flow — must_setup_totp=true ise buraya yönlendirilir.
                    Public /totp/setup route'u tmp_token flow'u için (register vs.) kalır.
                    Gate mode'da /totp/setup sayfası accessToken'ı store'dan okur. */}
                <Route path="/totp/setup" element={<TOTPSetupPage />} />

                {/* MustSetupTOTPGate: must_setup_totp=true ise /totp/setup'a yönlendirir */}
                <Route element={<MustSetupTOTPGate />}>
                  <Route element={<WsProvider><Outlet /></WsProvider>}>
                  <Route element={<><OnboardingTourBridge /><AppShell /></>}>
                    <Route index element={<PortalHomePage />} />
                    <Route path="/inventory/*" element={<InventoryPage />} />
                    <Route path="/catalog" element={<CatalogPage />} />
                    <Route path="/tags" element={<TagsPage />} />
                    <Route path="/graph" element={<GraphPage />} />
                    <Route path="/pipeline" element={<PipelineListPage />} />
                    <Route path="/pipeline/lifecycle" element={<LifecyclePage />} />
                    <Route path="/pipeline/:id" element={<DiagramPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/favorites" element={<FavoritesPage />} />
                    <Route path="/import" element={<ImportPage />} />
                    <Route path="/access-requests" element={<AccessRequestsPage />} />
                    <Route path="/catalog" element={<CatalogPage />} />
                    <Route path="/catalog/:kind/:namespace/:name" element={<EntityDetailPage />} />
                    <Route path="/create" element={<CreatePage />} />

                    {/* Admin */}
                    <Route element={<RoleGate role="admin" />}>
                      <Route path="/admin" element={<AdminDashboardPage />} />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route path="/admin/groups" element={<Navigate to="/admin/users?tab=groups" replace />} />
                      <Route path="/admin/roles" element={<Navigate to="/admin/users?tab=roles" replace />} />
                      <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
                      <Route path="/admin/client-certs" element={<AdminClientCertsPage />} />
                      <Route path="/admin/log-forwarding" element={<AdminLogForwardingPage />} />
                      <Route path="/admin/sso" element={<AdminSSOPage />} />
                      <Route path="/admin/scim" element={<AdminSCIMPage />} />
                      <Route path="/admin/secret-scanning" element={<AdminSecretScanningPage />} />
                      <Route path="/admin/k8s-clusters" element={<AdminK8sClustersPage />} />
                      <Route path="/admin/reports" element={<AdminReportsPage />} />
                      <Route path="/admin/portal-templates" element={<AdminPortalTemplatesPage />} />
                    </Route>
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
      </EntityPageRegistryProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
