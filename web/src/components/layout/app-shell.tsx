/**
 * AppShell — top-level layout for authenticated routes.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  TopBar (logo, user menu, theme toggle)      │
 *   ├────────┬─────────────────────────────────────┤
 *   │ Side   │                                     │
 *   │ bar    │  <Outlet />  ← page content         │
 *   │ (nav)  │                                     │
 *   └────────┴─────────────────────────────────────┘
 *
 * Sidebar nav links are hard-coded for now; PR-W3+ will populate the
 * admin / inventory sub-menus dynamically based on roles.
 */

import * as React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Folder, Shield, FileText, LogOut, Sun, Moon, Monitor, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { useAuthStore, selectIsAdmin } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useLogoutMutation } from '@/api/auth';
import { cn } from '@/lib/cn';

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const next = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? 'Aydınlık' : theme === 'dark' ? 'Karanlık' : 'Sistem';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      title={`Tema: ${label}`}
      aria-label="Tema değiştir"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
}
function NavItem({ to, icon: Icon, label }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const clear = useAuthStore((s) => s.clear);
  const logoutMut = useLogoutMutation();
  const [pwOpen, setPwOpen] = React.useState(false);

  async function handleLogout() {
    // Best-effort server logout — even if it fails, wipe local state.
    try {
      await logoutMut.mutateAsync();
    } catch {
      // ignored — store.clear handles credential wipe regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Envanter</span>
          <span className="text-xs text-muted-foreground">v0.3</span>
        </div>
        <div className="flex items-center gap-2">
          {user && <span className="text-sm text-muted-foreground">{user.username}</span>}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPwOpen(true)}
            title="Parola değiştir"
            aria-label="Parola değiştir"
          >
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title="Çıkış yap"
            aria-label="Çıkış"
            disabled={logoutMut.isPending}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r bg-background p-3">
          <nav className="flex flex-col gap-1">
            <NavItem to="/inventory" icon={Folder} label="Envanter" />
            {isAdmin && (
              <>
                <NavItem to="/admin/users" icon={Shield} label="Kullanıcılar" />
                <NavItem to="/admin/audit-log" icon={FileText} label="Audit Log" />
              </>
            )}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-muted/20 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
