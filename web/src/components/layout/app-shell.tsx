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
  ShieldAlert,
  UserCircle,
  Tag,
  Bell,
  CheckCheck,
  GitBranch,
  Network,
  Layers,
  AlertOctagon,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { useAuthStore, selectIsAdmin, selectIsBootstrap } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useLogoutMutation } from '@/api/auth';
import { useWsStatus } from '@/components/ws-provider';
import {
  useNotificationsQuery,
  useMarkReadMutation,
  useMarkAllReadMutation,
} from '@/api/notifications';
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

// --- Break-Glass Alert Banner (PR-N4) ---

function BreakGlassBanner() {
  const [alerts, setAlerts] = React.useState<Array<{ userId: string; time: Date }>>([]);
  const isAdmin = useAuthStore(selectIsAdmin);

  React.useEffect(() => {
    if (!isAdmin) return;
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ userId: string }>;
      setAlerts((prev) => [
        { userId: custom.detail.userId, time: new Date() },
        ...prev.slice(0, 4), // keep last 5
      ]);
    };
    window.addEventListener('break-glass:alert', handler);
    return () => window.removeEventListener('break-glass:alert', handler);
  }, [isAdmin]);

  if (!isAdmin || alerts.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      {alerts.map((a, i) => (
        <div
          key={`${a.userId}-${i}`}
          className="flex items-center gap-2 bg-red-600 px-4 py-1.5 text-sm font-medium text-white dark:bg-red-800"
        >
          <AlertOctagon className="h-4 w-4 shrink-0 animate-pulse" />
          <span>
            ⚠️ ACİL ERİŞİM (BREAK-GLASS) HESABI GİRİŞ YAPTI —{' '}
            {a.time.toLocaleTimeString('tr-TR')} — Kullanıcı: {a.userId.slice(0, 8)}…
          </span>
          <button
            className="ml-auto rounded p-0.5 hover:bg-white/20"
            onClick={() => setAlerts((prev) => prev.filter((_, j) => j !== i))}
            aria-label="Kapat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Notification Bell ---

function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const { data } = useNotificationsQuery();
  const markRead = useMarkReadMutation();
  const markAllRead = useMarkAllReadMutation();

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unread_count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `${unreadCount} okunmamış bildirim` : 'Bildirimler'}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Bildirimler</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-3 w-3" />
              Tümünü okundu işaretle
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
              <Bell className="mb-2 h-6 w-6 opacity-30" />
              Bildirim yok
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  className={cn(
                    'flex flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    !n.read_at && 'bg-primary/5',
                  )}
                  onClick={() => {
                    if (!n.read_at) {
                      markRead.mutate(n.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className={cn('flex flex-col', n.read_at ? 'pl-4' : '')}>
                      <span className="font-medium leading-snug">{n.title}</span>
                      {n.body && (
                        <span className="text-xs text-muted-foreground line-clamp-2">{n.body}</span>
                      )}
                      <span className="mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- AppShell ---

export function AppShell() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const isBootstrap = useAuthStore(selectIsBootstrap);
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
      {/* Bootstrap mode warning banner */}
      {isBootstrap && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black dark:bg-amber-700 dark:text-white">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Bootstrap Modu — TOTP atlanarak giriş yapıldı. İşiniz bitince çıkış yapın ve{' '}
            <code className="font-mono text-xs">ENVANTER_BOOTSTRAP_ENABLED=false</code> yapın.
          </span>
        </div>
      )}
      {/* Break-glass alert banners (PR-N4) — admin only, shown on WS event */}
      <BreakGlassBanner />

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
          <NotificationBell />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/profile')}
            aria-label="Profil ve güvenlik"
          >
            <UserCircle className="h-4 w-4" />
          </Button>
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
            <NavItem
              to="/tags"
              icon={Tag}
              label="Etiketlerim"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            <NavItem
              to="/graph"
              icon={GitBranch}
              label="İlişki Haritası"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            <NavItem
              to="/pipeline"
              icon={Network}
              label="Pipeline Diyagramları"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            <NavItem
              to="/pipeline/lifecycle"
              icon={Layers}
              label="Lifecycle Lanes"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            {isAdmin && (
              <>
                <NavItem
                  to="/admin/users"
                  icon={Shield}
                  label="Kullanıcı Yönetimi"
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
