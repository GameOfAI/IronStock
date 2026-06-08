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
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  Folder,
  LayoutGrid,
  Shield,
  ShieldCheck,
  FileText,
  LogOut,
  Sun,
  Moon,
  Monitor,
  KeyRound,
  Menu,
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
  Fingerprint,
  Radio,
  Upload,
  ClipboardCheck,
  Users2,
  ScanLine,
  ChevronDown,
  ChevronRight,
  Eye,
  Server,
  Star,
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
import { useWsDetail } from '@/components/ws-provider';
import {
  useNotificationsQuery,
  useMarkReadMutation,
  useMarkAllReadMutation,
} from '@/api/notifications';
import { cn } from '@/lib/cn';
import iconSvg from '@/assets/icon.svg';
import { RouteErrorBoundary } from '@/components/error-boundary';
import { APP_VERSION } from '@/version';
import { useSystemInfoQuery } from '@/api/system-info';

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
    <button
      type="button"
      className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      onClick={cycle}
      aria-label={`Tema: ${label}`}
      title={`Tema: ${label}`}
    >
      <Icon className="h-[15px] w-[15px]" />
    </button>
  );
}

// --- WS status indicator ---

function WsStatusDot() {
  const { status, errorReason, attempt, nextRetryIn } = useWsDetail();
  const [open, setOpen] = React.useState(false);

  const dotColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting' || status === 'reconnecting'
        ? 'bg-amber-400'
        : 'bg-destructive'; // offline / unknown

  const pulse = status === 'connecting' || status === 'reconnecting';

  const label =
    status === 'connected'
      ? 'Canlı bağlantı aktif'
      : status === 'connecting'
        ? 'Canlı bağlantı kuruluyor…'
        : status === 'reconnecting'
          ? `Yeniden bağlanılıyor… (deneme ${attempt})`
          : 'Gerçek zamanlı bağlantı yok';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-0.5 py-0.5 hover:opacity-80 focus-visible:outline-none"
          aria-label={label}
          title={label}
        >
          <span className="relative flex h-2 w-2 items-center justify-center">
            {pulse && (
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dotColor}`}
              />
            )}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-3 text-sm space-y-2">
        <div className="flex items-center gap-2 font-medium">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dotColor} shrink-0`} />
          <span>{label}</span>
        </div>

        {errorReason && (
          <div className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <p className="font-semibold mb-0.5">Son hata:</p>
            <p>{errorReason}</p>
          </div>
        )}

        {nextRetryIn !== undefined && nextRetryIn > 0 && (
          <p className="text-xs text-muted-foreground">
            {nextRetryIn} saniye sonra tekrar denenecek…
          </p>
        )}

        {status !== 'connected' && (
          <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
            <p className="font-medium text-foreground">Olası nedenler:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Sunucu kapalı veya ağ bağlantısı yok</li>
              <li>Oturum süresi dolmuş (token geçersiz)</li>
              <li>WebSocket proxy yanlış yapılandırılmış</li>
              <li>Tarayıcı uzantısı bağlantıyı engelliyor</li>
            </ul>
            <p className="pt-1">
              Not: Gerçek zamanlı bağlantı olmadan da uygulama çalışır; veriler manuel yenileme ile güncellenir.
            </p>
          </div>
        )}

        {status === 'connected' && (
          <p className="text-xs text-muted-foreground">
            Sunucudan anlık güncellemeler alınıyor.
          </p>
        )}
      </PopoverContent>
    </Popover>
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
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
          isActive
            ? 'bg-slate-800/80 text-slate-100'
            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
          collapsed && 'justify-center px-2',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('h-[15px] w-[15px] shrink-0', isActive && 'text-blue-400')} />
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

// --- Collapsible nav group ---

interface NavGroupProps {
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
  /** Extra paths (beyond children `to` props) that should activate this group */
  prefixes?: string[];
  children: React.ReactNode;
}

function NavGroup({ icon: Icon, label, collapsed, prefixes = [], children }: NavGroupProps) {
  const location = useLocation();
  // Collect `to` props from NavItem children for matching
  const childPaths = React.useMemo(() => {
    const paths: string[] = [];
    React.Children.forEach(children, (child) => {
      if (React.isValidElement<{ to?: string }>(child) && child.props.to) {
        paths.push(child.props.to);
      }
    });
    return paths;
  }, [children]);
  const isActive =
    childPaths.some((p) => location.pathname === p || location.pathname.startsWith(p + '/')) ||
    prefixes.some((p) => location.pathname === p);
  const [open, setOpen] = React.useState(isActive);

  // Auto-open when navigating into this group
  React.useEffect(() => {
    if (isActive && !open) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  if (collapsed) {
    // In collapsed mode, show only the group icon as a tooltip-trigger
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
          isActive
            ? 'text-slate-200'
            : 'text-slate-500 hover:bg-slate-900 hover:text-slate-300',
        )}
      >
        <Icon className={cn('h-[15px] w-[15px] shrink-0', isActive && 'text-blue-400')} />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        )}
      </button>
      {open && <div className="ml-2.5 flex flex-col gap-0.5 border-l border-slate-800 pl-2">{children}</div>}
    </div>
  );
}

// --- System status box (bottom of sidebar) ---

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}g ${h}s`;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function SystemStatusBox() {
  const { status } = useWsDetail();
  const isAdmin = useAuthStore(selectIsAdmin);
  const { data: info } = useSystemInfoQuery();

  const wsConnected = status === 'connected';
  const wsDotColor = wsConnected
    ? 'bg-emerald-400'
    : status === 'connecting' || status === 'reconnecting'
      ? 'bg-amber-400'
      : 'bg-red-400';
  const wsLabel = wsConnected ? 'Bağlı' : status === 'reconnecting' ? 'Bağlanıyor…' : 'Bağlantı yok';

  const dbHealthy = info?.db_status === 'healthy';
  const dbDotColor = info ? (dbHealthy ? 'bg-emerald-400' : 'bg-red-400') : 'bg-slate-600';

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
      {/* Row 1: WS status + server version */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center">
            {wsConnected && (
              <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400 opacity-50" />
            )}
            <span className={`relative h-1.5 w-1.5 rounded-full ${wsDotColor}`} />
          </span>
          <span className={cn(
            'font-mono uppercase tracking-wider',
            wsConnected ? 'text-emerald-400' : 'text-slate-500',
          )}>
            {wsLabel}
          </span>
        </div>
        {info?.server_version && (
          <span className="font-mono text-[10px] text-slate-500">
            v{info.server_version}
          </span>
        )}
      </div>

      {/* Row 2: Uptime + DB status */}
      <div className="flex items-center justify-between font-mono text-[10px] text-slate-500">
        <span>
          {info ? `Uptime: ${formatUptime(info.uptime_seconds)}` : '—'}
        </span>
        <div className="flex items-center gap-1">
          <span>DB</span>
          <span className={`h-1.5 w-1.5 rounded-full ${dbDotColor}`} />
        </div>
      </div>

      {/* Row 3: Admin-only online users */}
      {isAdmin && info?.online_users != null && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          <Users2 className="h-2.5 w-2.5" />
          <span>{info.online_users} kullanıcı online</span>
          {info.ws_connections > 0 && info.ws_connections !== info.online_users && (
            <span className="text-slate-600">({info.ws_connections} oturum)</span>
          )}
        </div>
      )}
    </div>
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
        <button
          type="button"
          className="relative rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label={unreadCount > 0 ? `${unreadCount} okunmamış bildirim` : 'Bildirimler'}
          title="Bildirimler"
        >
          <Bell className="h-[15px] w-[15px]" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
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

// Page title map for TopBar
const NAV_LABELS: Record<string, string> = {
  '/inventory': 'Envanter',
  '/tags': 'Etiketlerim',
  '/graph': 'İlişki Haritası',
  '/pipeline': 'Pipeline Diyagramları',
  '/pipeline/lifecycle': 'Lifecycle Lanes',
  '/import': 'Toplu İçe Aktarma',
  '/access-requests': 'Onay İstekleri',
  '/admin': 'Admin Paneli',
  '/admin/users': 'Kullanıcı Yönetimi',
  '/admin/groups': 'Gruplar',
  '/admin/roles': 'Roller',
  '/admin/audit-log': 'Audit Log',
  '/admin/client-certs': 'Sertifikalar',
  '/admin/log-forwarding': 'Log Yönlendirme',
  '/admin/sso': 'SSO / LDAP',
  '/admin/scim': 'SCIM Provisioning',
  '/admin/secret-scanning': 'Sızıntı Taraması',
  '/admin/k8s-clusters': 'K8s Kümeleri',
  '/admin/reports': 'Raporlar',
  '/profile': 'Profil',
};

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const isBootstrap = useAuthStore(selectIsBootstrap);
  const clear = useAuthStore((s) => s.clear);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const logoutMut = useLogoutMutation();
  const [pwOpen, setPwOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Find the best-matching label for the current path
  const pageTitle = React.useMemo(() => {
    const path = location.pathname;
    // Exact match first, then prefix match (longest wins)
    const match = Object.keys(NAV_LABELS)
      .filter((k) => path === k || path.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match ? NAV_LABELS[match] : 'IronStock';
  }, [location.pathname]);

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
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      {/* Bootstrap mode warning banner */}
      {isBootstrap && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-600 px-4 py-1.5 text-sm font-medium text-white">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Bootstrap Modu — TOTP atlanarak giriş yapıldı. İşiniz bitince çıkış yapın ve{' '}
            <code className="font-mono text-xs">ENVANTER_BOOTSTRAP_ENABLED=false</code> yapın.
          </span>
        </div>
      )}
      {/* Break-glass alert banners (PR-N4) */}
      <BreakGlassBanner />

      {/* Top bar — IronStock design */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3">
        {/* Mobile hamburger */}
        <button
          type="button"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:hidden"
          aria-label="Menüyü aç/kapat"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <Menu className="h-4 w-4" />
        </button>
        {/* Desktop sidebar collapse toggle */}
        <button
          type="button"
          className="hidden rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:block"
          aria-label={sidebarCollapsed ? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu daralt'}
          onClick={toggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Logo + branding */}
        <div className="flex items-center gap-2">
          <img src={iconSvg} alt="IronStock" className="h-6 w-6" />
          <span className="text-[14px] font-semibold tracking-tight text-slate-100">IronStock</span>
          <span className="font-mono text-[10px] text-slate-500">v{APP_VERSION}</span>
          <span className="mx-1.5 h-3 w-px bg-slate-800" />
          <span className="text-[13px] text-slate-400">{pageTitle}</span>
        </div>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-1">
          {/* WS status + username pill */}
          <div className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 px-2 py-1 text-[11px]">
            <WsStatusDot />
            {user && (
              <span className="hidden font-mono text-slate-400 sm:inline">{user.username}</span>
            )}
          </div>

          <NotificationBell />
          <ThemeToggle />
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={() => navigate('/profile')}
            aria-label="Profil ve güvenlik"
            title="Profil"
          >
            <UserCircle className="h-[15px] w-[15px]" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={() => setPwOpen(true)}
            aria-label="Parola değiştir"
            title="Şifre değiştir"
          >
            <KeyRound className="h-[15px] w-[15px]" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={handleLogout}
            aria-label="Çıkış yap"
            title="Çıkış"
            disabled={logoutMut.isPending}
          >
            <LogOut className="h-[15px] w-[15px]" />
          </button>
        </div>
      </header>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />

      <div className="relative flex flex-1 overflow-hidden">
        {/* Mobile overlay backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar — IronStock design */}
        <aside
          className={cn(
            'hidden md:flex md:flex-col border-r border-slate-800 bg-slate-950 transition-all duration-200',
            sidebarCollapsed ? 'md:w-14' : 'md:w-56',
            mobileOpen &&
              'flex flex-col fixed inset-y-0 left-0 z-30 w-56 border-r border-slate-800 bg-slate-950 pt-12',
          )}
          aria-label="Ana navigasyon"
        >
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2" role="navigation">
            {/* ── Envanter Grubu ── */}
            <NavGroup
              icon={Archive}
              label="Envanter"
              collapsed={sidebarCollapsed && !mobileOpen}
              prefixes={['/inventory', '/catalog', '/tags', '/favorites']}
            >
              <NavItem
                to="/inventory"
                icon={Folder}
                label="Vault"
                collapsed={sidebarCollapsed && !mobileOpen}
              />
              <NavItem
                to="/catalog"
                icon={LayoutGrid}
                label="Katalog"
                collapsed={sidebarCollapsed && !mobileOpen}
              />
              <NavItem
                to="/tags"
                icon={Tag}
                label="Etiketlerim"
                collapsed={sidebarCollapsed && !mobileOpen}
              />
              <NavItem
                to="/favorites"
                icon={Star}
                label="Favorilerim"
                collapsed={sidebarCollapsed && !mobileOpen}
              />
            </NavGroup>
            <NavItem
              to="/import"
              icon={Upload}
              label="Toplu Aktarma"
              collapsed={sidebarCollapsed && !mobileOpen}
            />
            <NavItem
              to="/access-requests"
              icon={ClipboardCheck}
              label="Onay İstekleri"
              collapsed={sidebarCollapsed && !mobileOpen}
            />

            {/* ── Görselleştirme ── */}
            {!(sidebarCollapsed && !mobileOpen) && (
              <div className="my-1.5 h-px bg-slate-800" />
            )}
            <NavGroup
              icon={Eye}
              label="Görselleştirme"
              collapsed={sidebarCollapsed && !mobileOpen}
              prefixes={[]}
            >
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
            </NavGroup>

            {/* ── Admin ── */}
            {isAdmin && (
              <>
                {!(sidebarCollapsed && !mobileOpen) && (
                  <div className="my-1.5 h-px bg-slate-800" />
                )}

                {/* Kullanıcı & Erişim */}
                <NavGroup
                  icon={Users2}
                  label="Kullanıcı & Erişim"
                  collapsed={sidebarCollapsed && !mobileOpen}
                  prefixes={['/admin']}
                >
                  <NavItem
                    to="/admin"
                    icon={Shield}
                    label="Kullanıcı Yönetimi"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/groups"
                    icon={Users2}
                    label="Gruplar"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/roles"
                    icon={ShieldCheck}
                    label="Roller"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/sso"
                    icon={ShieldCheck}
                    label="SSO / LDAP"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/scim"
                    icon={Users2}
                    label="SCIM Provisioning"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/client-certs"
                    icon={Fingerprint}
                    label="Sertifikalar"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                </NavGroup>

                {/* Güvenlik & İzleme */}
                <NavGroup
                  icon={ShieldAlert}
                  label="Güvenlik & İzleme"
                  collapsed={sidebarCollapsed && !mobileOpen}
                  prefixes={[]}
                >
                  <NavItem
                    to="/admin/audit-log"
                    icon={FileText}
                    label="Audit Log"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/log-forwarding"
                    icon={Radio}
                    label="Log Yönlendirme"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/secret-scanning"
                    icon={ScanLine}
                    label="Sızıntı Taraması"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                  <NavItem
                    to="/admin/reports"
                    icon={FileText}
                    label="Raporlar"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                </NavGroup>

                {/* Altyapı */}
                <NavGroup
                  icon={Server}
                  label="Altyapı"
                  collapsed={sidebarCollapsed && !mobileOpen}
                  prefixes={[]}
                >
                  <NavItem
                    to="/admin/k8s-clusters"
                    icon={Layers}
                    label="K8s Kümeleri"
                    collapsed={sidebarCollapsed && !mobileOpen}
                  />
                </NavGroup>
              </>
            )}
          </nav>

          {/* WS status box at bottom — only when expanded */}
          {!sidebarCollapsed && (
            <div className="border-t border-slate-800 p-3">
              <SystemStatusBox />
            </div>
          )}
        </aside>

        {/* Main content */}
        <main id="main-content" tabIndex={-1} className="relative flex-1 overflow-auto bg-slate-950 outline-none" role="main">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
