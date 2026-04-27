/**
 * AppShell — top-level layout for authenticated routes.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  TopBar (logo, WS status, user menu, theme)  │
 *   ├────────┬─────────────────────────────────────┤
 *   │ Side   │                                     │
 *   │ bar    │  <Outlet />  ← page content         │
 *   │ (nav)  │                                     │
 *   └────────┴─────────────────────────────────────┘
 *
 * Responsive: sidebar collapses to icon-only on md, hidden on mobile with
 * hamburger toggle. sidebarCollapsed persisted to localStorage via ui store.
 */

import * as React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Folder,
  Shield,
  FileText,
  LogOut,
  Sun,
  Moon,
  Monitor,
  KeyRound,
  Menu,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { useAuthStore, selectIsAdmin } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useLogoutMutation } from '@/api/auth';
import { useWsStatus } from '@/components/ws-provider';
import { cn } from '@/lib/cn';

// --- Theme toggle ---

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const cycle = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? 'Aydınlık' : theme === 'dark' ? 'Karanlık' : 'Sistem';

  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label={`Tema: ${label}`}>
      <Icon className="h-4 w-4" />
    </Button>
  );
}

// --- WS status indicator ---

function WsStatusDot() {
  const status = useWsStatus();

  if (status === 'connected') return null; // Silent when healthy.

  return (
    <span
      aria-label={
        status === 'connecting'
          ? 'Sunucuya bağlanılıyor'
          : status === 'reconnecting'
            ? 'Yeniden bağlanılıyor'
            : 'Çevrimdışı'
      }
      title={
        status === 'connecting'
          ? 'Canlı bağlantı kuruluyor…'
          : status === 'reconnecting'
            ? 'Bağlantı kesildi, yeniden deneniyor…'
            : 'Gerçek zamanlı bağlantı yok'
      }
      className="flex items-center"
    >
      {status === 'offline' ? (
        <WifiOff className="h-4 w-4 text-destructive" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {status === 'offline' && (
        <Wifi className="h-3 w-3 text-destructive opacity-0 absolute" aria-hidden />
      )}
    </span>
  );
}

// --- Nav item ---

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon: Icon, label, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          collapsed && 'justify-center px-2',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

// --- AppShell ---

export function AppShell() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const clear = useAuthStore((s) => s.clear);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const logoutMut = useLogoutMutation();
  const [pwOpen, setPwOpen] = React.useState(false);
  // Mobile overlay: sidebar is hidden by default on small screens
  const [mobileOpen, setMobileOpen] = React.useState(false);

  async function handleLogout() {
    try {
      await logoutMut.mutateAsync();
    } catch {
      // ignored
    }
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-2">
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Menüyü aç/kapat"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* Desktop sidebar collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex"
            aria-label={sidebarCollapsed ? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu daralt'}
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">Envanter</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">v0.3</span>
        </div>

        <div className="flex items-center gap-2">
          <WsStatusDot />
          {user && (
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.username}</span>
          )}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPwOpen(true)}
            aria-label="Parola değiştir"
          >
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label="Çıkış yap"
            disabled={logoutMut.isPending}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />

      <div className="relative flex flex-1 overflow-hidden">
        {/* Mobile overlay backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            // Desktop: always visible, width controlled by collapsed state
            'hidden md:flex md:flex-col border-r bg-background transition-all duration-200',
            sidebarCollapsed ? 'md:w-14' : 'md:w-56',
            // Mobile: fixed overlay, shown when mobileOpen
            mobileOpen &&
              'flex flex-col fixed inset-y-0 left-0 z-30 w-56 border-r bg-background pt-14',
          )}
          aria-label="Ana navigasyon"
        >
          <nav className="flex flex-col gap-1 p-2" role="navigation">
            <NavItem
              to="/inventory"
              icon={Folder}
              label="Envanter"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            {isAdmin && (
              <>
                <NavItem
                  to="/admin/users"
                  icon={Shield}
                  label="Kullanıcılar"
                  collapsed={sidebarCollapsed && !mobileOpen}
                />
                <NavItem
                  to="/admin/audit-log"
                  icon={FileText}
                  label="Audit Log"
                  collapsed={sidebarCollapsed && !mobileOpen}
                />
              </>
            )}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-muted/20 p-4 md:p-6" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
