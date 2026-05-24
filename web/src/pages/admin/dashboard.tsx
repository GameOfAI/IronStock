/**
 * AdminDashboard — /admin  (PR-UX8)
 *
 * 6 widget kartı:
 *   1. Güvenlik Skoru   — MFA benimseme oranı (radial gauge)
 *   2. Expiry Uyarıları — bildirimlerden expiry tipi filtre
 *   3. Kullanıcı İst.   — aktif / MFA eksik / admin sayıları
 *   4. Audit Özeti      — son 5 audit olayı
 *   5. Bildirimler      — toplam okunmamış badge + liste
 *   6. Hızlı Linkler    — admin kısayolları
 *
 * Tüm veri mevcut API hook'larından; yeni backend endpoint gerekmez.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsers, useAuditLog, downloadAdminExport, downloadEncryptedExport, type ExportFormat } from '@/api/admin';
import { useHealthReportQuery } from '@/api/health';
import { useNotificationsQuery } from '@/api/notifications';
import { RelativeTime } from '@/components/common/relative-time';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

// --- Radial gauge SVG ---

function RadialGauge({ value, label }: { value: number; label: string }) {
  // value: 0-100 percentage
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;
  const color =
    value >= 80 ? 'text-green-500' : value >= 50 ? 'text-amber-500' : 'text-red-500';
  const strokeColor =
    value >= 80 ? '#22c55e' : value >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-24">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          {/* Background track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-muted/30"
          />
          {/* Progress arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="10"
            strokeDasharray={`${progress} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-xl font-bold tabular-nums', color)}>{value}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// --- Stat chip ---

function StatChip({
  icon: Icon,
  value,
  label,
  variant = 'default',
}: {
  icon: React.ElementType;
  value: number | string;
  label: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const cls = {
    default: 'text-foreground',
    warning: 'text-amber-500',
    danger: 'text-destructive',
    success: 'text-green-500',
  }[variant];

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-card px-4 py-3">
      <Icon className={cn('h-5 w-5', cls)} aria-hidden />
      <span className={cn('text-2xl font-bold tabular-nums', cls)}>{value}</span>
      <span className="text-[11px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// --- Audit action icon/label helpers ---

const ACTION_LABELS: Record<string, string> = {
  login: 'Giriş',
  logout: 'Çıkış',
  login_failed: 'Hatalı giriş',
  item_create: 'Item oluşturma',
  item_update: 'Item güncelleme',
  item_delete: 'Item silme',
  item_view: 'Item görüntüleme',
  folder_create: 'Klasör oluşturma',
  folder_delete: 'Klasör silme',
  user_create: 'Kullanıcı oluşturma',
  role_grant: 'Rol verildi',
  role_revoke: 'Rol alındı',
  totp_enable: 'TOTP etkinleştirildi',
  totp_disable: 'TOTP devre dışı',
  password_change: 'Şifre değişikliği',
  share_create: 'Paylaşım oluşturma',
  share_revoke: 'Paylaşım iptal',
};

// --- Notification type colors ---

function notifIcon(type: string) {
  switch (type) {
    case 'expiry_warning':
      return <Clock className="h-3.5 w-3.5 text-amber-500" />;
    case 'expiry_critical':
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    case 'break_glass':
      return <ShieldAlert className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Bell className="h-3.5 w-3.5 text-blue-500" />;
  }
}

// --- Dashboard ---

export default function AdminDashboardPage() {
  useDocumentTitle('Admin Paneli');
  // Fetch up to 500 users to compute stats (cache keeps it cheap)
  const usersQuery = useUsers({ limit: 500, offset: 0 });
  const auditQuery = useAuditLog({ limit: 5, offset: 0 });
  const notifQuery = useNotificationsQuery();

  // Export state
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  async function handleExport(fmt: ExportFormat) {
    if (exporting) return;
    setExporting(fmt);
    try {
      await downloadAdminExport(fmt);
    } finally {
      setExporting(null);
    }
  }

  // PR-EXPORT: Encrypted ZIP export state.
  const [encExporting, setEncExporting] = useState(false);
  const [encExportScope, setEncExportScope] = useState<'all' | 'custom'>('all');
  const [encExportCustomScope, setEncExportCustomScope] = useState('');
  async function handleEncryptedExport() {
    if (encExporting) return;
    const scope = encExportScope === 'all' ? 'all' : encExportCustomScope.trim();
    if (!scope) return;
    setEncExporting(true);
    try {
      await downloadEncryptedExport({ scope, include_attachments: false });
    } finally {
      setEncExporting(false);
    }
  }

  // User stats
  const userStats = useMemo(() => {
    const users = usersQuery.data?.users ?? [];
    const total = usersQuery.data?.total ?? users.length;
    const active = users.filter((u) => u.status === 'active').length;
    const noMFA = users.filter((u) => u.status === 'pending_totp').length;
    const disabled = users.filter((u) => u.status === 'disabled' || u.status === 'locked').length;
    const admins = users.filter((u) => u.roles.includes('admin')).length;
    // Security score: base 40 + MFA adoption (up to 50) + no disabled (up to 10)
    const mfaRate = total > 0 ? (active / total) : 0;
    const score = Math.round(40 + mfaRate * 50 + (noMFA === 0 ? 10 : 0));
    return { total, active, noMFA, disabled, admins, score: Math.min(score, 100) };
  }, [usersQuery.data]);

  // Expiry notifications
  const expiryNotifs = useMemo(
    () =>
      (notifQuery.data?.notifications ?? []).filter((n) =>
        n.type.startsWith('expiry'),
      ),
    [notifQuery.data],
  );

  const unreadCount = notifQuery.data?.unread_count ?? 0;

  const isLoading = usersQuery.isLoading || auditQuery.isLoading;

  return (
    <div className="h-full overflow-auto p-6">
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Admin Dashboard</h1>
        <span className="text-xs text-muted-foreground">
          Son güncelleme: <RelativeTime iso={new Date().toISOString()} />
        </span>
      </div>

      {/* Row 1: Security Score + User Stats + Expiry Alerts */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">

        {/* 1. Güvenlik Skoru */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Güvenlik Skoru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Skeleton className="h-24 w-24 rounded-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <RadialGauge value={userStats.score} label="/ 100" />
                <div className="w-full space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>MFA etkin kullanıcı</span>
                    <span className="font-medium text-foreground">
                      {userStats.active}/{userStats.total}
                    </span>
                  </div>
                  {userStats.noMFA > 0 && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      <span>{userStats.noMFA} kullanıcı MFA kurmamış</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Kullanıcı İstatistikleri */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4 text-primary" />
              Kullanıcılar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <StatChip
                  icon={Users}
                  value={userStats.total}
                  label="Toplam"
                />
                <StatChip
                  icon={CheckCircle2}
                  value={userStats.active}
                  label="Aktif"
                  variant="success"
                />
                <StatChip
                  icon={KeyRound}
                  value={userStats.noMFA}
                  label="MFA Eksik"
                  variant={userStats.noMFA > 0 ? 'warning' : 'default'}
                />
                <StatChip
                  icon={XCircle}
                  value={userStats.disabled}
                  label="Devre dışı"
                  variant={userStats.disabled > 0 ? 'danger' : 'default'}
                />
              </div>
            )}
            <Link
              to="/admin/users"
              className="mt-3 flex items-center justify-end gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Tümünü yönet <ChevronRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        {/* 3. Expiry Uyarıları */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-amber-500" />
              Expiry Uyarıları
              {expiryNotifs.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {expiryNotifs.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notifQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : expiryNotifs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <p className="text-xs text-muted-foreground">
                  Yaklaşan expiry uyarısı yok
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {expiryNotifs.slice(0, 5).map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2 py-1.5 text-xs',
                      !n.read_at && 'bg-amber-500/5 border border-amber-500/20',
                    )}
                  >
                    {notifIcon(n.type)}
                    <span className="flex-1 leading-snug">{n.title}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      <RelativeTime iso={n.created_at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Audit Log + Bildirimler + Hızlı Linkler */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">

        {/* 4. Audit Log Özeti */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-primary" />
              Son Olaylar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : (auditQuery.data?.entries ?? []).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Audit kaydı yok</p>
            ) : (
              <div className="divide-y">
                {(auditQuery.data?.entries ?? []).map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-2 text-xs">
                    <span className="shrink-0 font-medium text-muted-foreground w-28 truncate">
                      {e.actor_user_id ? e.actor_user_id.slice(0, 8) : 'sistem'}
                    </span>
                    <span className="flex-1 truncate">
                      {ACTION_LABELS[e.action] ?? e.action}
                      {e.resource_type && (
                        <span className="text-muted-foreground"> · {e.resource_type}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      <RelativeTime iso={e.created_at} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/admin/audit-log"
              className="mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Tüm log <ChevronRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        {/* 5. Bildirimler + 6. Hızlı Linkler */}
        <div className="flex flex-col gap-4">
          {/* Bildirimler özet */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4 text-primary" />
                Bildirimler
                {unreadCount > 0 && (
                  <Badge className="ml-auto text-[10px] bg-primary">
                    {unreadCount}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {notifQuery.isLoading ? (
                <Skeleton className="h-12" />
              ) : unreadCount === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Tüm bildirimler okundu
                </div>
              ) : (
                <p className="text-sm font-medium">
                  <span className="text-primary">{unreadCount}</span>{' '}
                  <span className="text-muted-foreground">okunmamış bildirim</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Hızlı Linkler */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Hızlı Erişim</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <nav className="space-y-1">
                {[
                  { to: '/admin/users', icon: Users, label: 'Kullanıcı Yönetimi' },
                  { to: '/admin/users?tab=groups', icon: Users, label: 'Grup Yönetimi' },
                  { to: '/admin/users?tab=roles', icon: ShieldCheck, label: 'Rol Yönetimi' },
                  { to: '/admin/audit-log', icon: FileText, label: 'Audit Log' },
                  { to: '/inventory', icon: Calendar, label: 'Envanter' },
                ].map(({ to, icon: Icon, label }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                    <ChevronRight className="h-3 w-3 ml-auto" />
                  </Link>
                ))}
              </nav>

              {/* Metadata Export */}
              <div className="border-t pt-2">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Metadata Export
                </p>
                <div className="flex gap-1.5">
                  {(['json', 'csv'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      disabled={exporting !== null}
                      onClick={() => handleExport(fmt)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
                    >
                      {exporting === fmt ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Şifreli alanlar dahil edilmez.
                </p>
              </div>

              {/* PR-EXPORT: Encrypted ZIP Export */}
              <div className="border-t pt-2">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Şifreli ZIP Export
                </p>
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEncExportScope('all')}
                      className={`flex-1 rounded border px-2 py-1 text-[10px] transition ${encExportScope === 'all' ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'}`}
                    >
                      Tüm Vault
                    </button>
                    <button
                      type="button"
                      onClick={() => setEncExportScope('custom')}
                      className={`flex-1 rounded border px-2 py-1 text-[10px] transition ${encExportScope === 'custom' ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'}`}
                    >
                      Kapsam Belirt
                    </button>
                  </div>
                  {encExportScope === 'custom' && (
                    <input
                      type="text"
                      placeholder="folder:{uuid} veya user:{uuid}"
                      value={encExportCustomScope}
                      onChange={(e) => setEncExportCustomScope(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900/80 px-2 py-1 font-mono text-[10px] text-slate-300 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                    />
                  )}
                  <button
                    type="button"
                    disabled={encExporting || (encExportScope === 'custom' && !encExportCustomScope.trim())}
                    onClick={handleEncryptedExport}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-violet-700 bg-violet-900/30 px-2 py-1.5 text-[11px] text-violet-300 transition hover:bg-violet-800/40 disabled:opacity-50"
                  >
                    {encExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    Şifreli ZIP İndir
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Tüm şifreli blob'ları içerir (disaster recovery). Güvenli yerde saklayın.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── PR-HEALTH: Sağlıksız Item'lar widget ───────────────────────── */}
      <UnhealthyItemsWidget />
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PR-HEALTH: Sağlıksız Item'lar widget
// ─────────────────────────────────────────────────────────────────────────────

const sevColors: Record<string, string> = {
  healthy:  'text-green-600',
  warning:  'text-amber-600',
  critical: 'text-red-600',
};

function UnhealthyItemsWidget() {
  const { data, isLoading } = useHealthReportQuery(70, 10);

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Sağlıksız Item'lar (skor &lt; 70)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : !data || data.count === 0 ? (
            <p className="text-sm text-muted-foreground">Tüm item'lar sağlıklı görünüyor.</p>
          ) : (
            <div className="divide-y">
              {data.items.map((item) => (
                <div key={item.item_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate max-w-[60%]">{item.name || item.item_id}</span>
                  <span className={`font-mono font-semibold ${sevColors[item.severity] ?? ''}`}>
                    {item.health_score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
