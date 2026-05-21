import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { selectIsAdmin, selectIsAuthenticated, useAuthStore } from '@/store/auth';

function Splash() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex w-64 flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function AuthGate() {
  const hydrating = useAuthStore((s) => s.hydrating);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const location = useLocation();

  if (hydrating) return <Splash />;
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * MustSetupTOTPGate — if the session has mustSetupTOTP=true, redirect to
 * /totp/setup. Placed inside AuthGate wrapping app routes (PR-SEC2).
 * Cleared after successful TOTP enrollment via the gate flow.
 */
export function MustSetupTOTPGate() {
  const mustSetupTOTP = useAuthStore((s) => s.mustSetupTOTP);
  if (mustSetupTOTP) {
    return <Navigate to="/totp/setup" replace />;
  }
  return <Outlet />;
}

/**
 * AdminGate — admin rolü yoksa /inventory'e yönlendirir.
 * Admin sayfalarını doğrudan URL ile erişime kapatır.
 */
export function AdminGate() {
  const isAdmin = useAuthStore(selectIsAdmin);
  if (!isAdmin) {
    return <Navigate to="/inventory" replace />;
  }
  return <Outlet />;
}
