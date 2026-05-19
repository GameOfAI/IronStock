/**
 * AuthGate — wraps routes that require an authenticated session.
 *
 * Behaviour:
 *  - hydrating: render <Splash /> (avoids auth flicker on first paint)
 *  - not authed: redirect to /login (preserve intended path in state)
 *  - authed:    render <Outlet />
 *
 * MustChangePasswordGate blocks all child routes until the user changes
 * their password. Used for admin-created accounts and the seed admin.
 *
 * RoleGate is a thin extension that additionally enforces a required role.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { selectIsAuthenticated, useAuthStore } from '@/store/auth';

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
 * MustChangePasswordGate — if the session has mustChangePassword=true,
 * redirect to /change-password regardless of where the user is trying to go.
 * Placed inside AuthGate, wrapping all regular app routes.
 */
export function MustChangePasswordGate() {
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  if (mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/**
 * MustSetupTOTPGate — if the session has mustSetupTOTP=true, redirect to
 * /totp/setup regardless of where the user is trying to go.
 * Placed inside MustChangePasswordGate (password gate fires first).
 * Cleared after successful TOTP enrollment via the gate flow (PR-SEC2).
 */
export function MustSetupTOTPGate() {
  const mustSetupTOTP = useAuthStore((s) => s.mustSetupTOTP);
  if (mustSetupTOTP) {
    return <Navigate to="/totp/setup" replace />;
  }
  return <Outlet />;
}

interface RoleGateProps {
  role: string;
  children?: React.ReactNode;
}
export function RoleGate({ role, children }: RoleGateProps) {
  const user = useAuthStore((s) => s.user);
  const has = user?.roles.includes(role) ?? false;
  if (!has) return <Navigate to="/inventory" replace />;
  return <>{children ?? <Outlet />}</>;
}
