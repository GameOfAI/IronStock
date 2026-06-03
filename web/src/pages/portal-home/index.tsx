import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Globe,
  Database,
  Key,
  ShieldCheck,
  Cloud,
  FileText,
  Lock,
  BookOpen,
  AlertTriangle,
  Clock,
  PlusCircle,
  Package,
  HeartPulse,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RelativeTime } from '@/components/common/relative-time';
import { usePortalStatsQuery } from '@/api/portal-home';
import { useHealthReportQuery } from '@/api/health';
import { useAuthStore, selectIsAdmin } from '@/store/auth';

const KIND_ICON: Record<string, React.ElementType> = {
  Server: Server,
  Service: Globe,
  Database: Database,
  SSHKey: Key,
  Certificate: ShieldCheck,
  CloudCredential: Cloud,
  Note: FileText,
  Credential: Lock,
};

const KIND_COLOR: Record<string, string> = {
  Server: 'text-blue-400',
  Service: 'text-violet-400',
  Database: 'text-emerald-400',
  SSHKey: 'text-amber-400',
  Certificate: 'text-amber-400',
  CloudCredential: 'text-sky-400',
  Note: 'text-slate-400',
  Credential: 'text-rose-400',
};

function ExpiryLabel({ expiresAt }: { expiresAt: string }) {
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (days <= 7) return <span className="text-xs text-red-500 font-medium">{days}g içinde doluyor</span>;
  if (days <= 30) return <span className="text-xs text-amber-500">{days}g içinde doluyor</span>;
  return <span className="text-xs text-muted-foreground">{days}g içinde doluyor</span>;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  healthy: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
};

function HealthSummaryCard() {
  const isAdmin = useAuthStore(selectIsAdmin);
  const { data, isLoading } = useHealthReportQuery(70, 5);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-rose-500" />
          Sağlık Durumu
          {data && data.count > 0 && (
            <Badge variant="outline" className="text-[10px] ml-auto">
              {data.count} sorunlu
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded" />
          ))
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Tüm entity'ler sağlıklı.
          </p>
        ) : (
          <>
            {data.items.map((item) => (
              <Link
                key={item.item_id}
                to={`/inventory?item=${item.item_id}`}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-accent transition-colors"
              >
                <span className="text-sm truncate">{item.name || item.item_id.slice(0, 8)}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono tabular-nums">{item.health_score}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${SEVERITY_STYLES[item.severity] ?? ''}`}
                  >
                    {item.severity}
                  </Badge>
                </div>
              </Link>
            ))}
            <div className="pt-1">
              <Link to="/admin" className="text-xs text-primary hover:underline">
                Tüm raporu gör →
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function PortalHomePage() {
  const { isLoading, isError, stats } = usePortalStatsQuery();

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Developer Portal</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tüm entity'lerin merkezi kataloğu
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/create">
            <PlusCircle className="h-4 w-4 mr-1.5" />
            Yeni Entity
          </Link>
        </Button>
      </div>

      {/* Kind stats */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Entity Dağılımı
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-red-500">İstatistikler yüklenemedi.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.by_kind.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  Henüz hiç entity yok.
                </CardContent>
              </Card>
            ) : (
              stats.by_kind.map(({ kind, count }) => {
                const Icon = KIND_ICON[kind] ?? BookOpen;
                const color = KIND_COLOR[kind] ?? 'text-muted-foreground';
                return (
                  <Link key={kind} to={`/catalog?kind=${kind}`}>
                    <Card className="hover:bg-accent transition-colors cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`h-4 w-4 ${color}`} />
                          <span className="text-sm font-medium">{kind}</span>
                        </div>
                        <p className="text-2xl font-bold tabular-nums">{count}</p>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })
            )}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">Toplam</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{stats.total_items}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Expiring soon */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Yakında Dolacak (30 gün)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded" />
              ))
            ) : stats.expiring_soon.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Yakında dolacak entity yok.</p>
            ) : (
              stats.expiring_soon.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.kind && (
                      <span className="shrink-0 rounded border border-slate-700 bg-slate-800/60 px-1 font-mono text-[9px] uppercase tracking-wide text-slate-400">
                        {item.kind}
                      </span>
                    )}
                    <span className="text-sm truncate">{item.name}</span>
                  </div>
                  {item.expires_at && <ExpiryLabel expiresAt={item.expires_at} />}
                </div>
              ))
            )}
            {stats.expiring_soon.length > 0 && (
              <div className="pt-1">
                <Link to="/catalog" className="text-xs text-primary hover:underline">
                  Tümünü görüntüle →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recently updated */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Son Güncellenler
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 rounded" />
              ))
            ) : stats.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Henüz entity yok.</p>
            ) : (
              stats.recent.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.kind && (
                      <span className="shrink-0 rounded border border-slate-700 bg-slate-800/60 px-1 font-mono text-[9px] uppercase tracking-wide text-slate-400">
                        {item.kind}
                      </span>
                    )}
                    <span className="text-sm truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    <RelativeTime iso={item.updated_at} />
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Health summary — admin only */}
      <HealthSummaryCard />

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Hızlı Erişim
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/catalog">Tüm Entityler</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/graph">İlişki Haritası</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/pipeline/lifecycle">Lifecycle Lanes</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/tags">Etiketlerim</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
