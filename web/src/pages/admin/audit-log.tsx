/**
 * /admin/audit-log — admin audit log viewer.
 *
 * Filter state + pagination URL search params'da. Username mapping
 * `useUsers` cache'inden client-side derive (ADR-0009 §5).
 */

import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCcw } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog, useUsers } from '@/api/admin';
import { ApiError } from '@/api/errors';
import { AuditFilters, EMPTY_FILTERS } from '@/components/admin/audit-filters';
import type { AuditFilterState } from '@/components/admin/audit-filters';
import { AuditRow } from '@/components/admin/audit-row';
import { Pagination } from '@/components/common/pagination';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

const DEFAULT_LIMIT = 50;
const ALLOWED_LIMITS = [25, 50, 100];
// Pull a wide enough user list for the actor filter — server caps at 200 per page.
const USER_LIST_LIMIT = 200;

function parseFilters(params: URLSearchParams): AuditFilterState & {
  limit: number;
  offset: number;
} {
  const sizeRaw = Number(params.get('size'));
  const limit = ALLOWED_LIMITS.includes(sizeRaw) ? sizeRaw : DEFAULT_LIMIT;
  const pageRaw = Number(params.get('page'));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  return {
    action: params.get('action') ?? '',
    actor_user_id: params.get('actor_user_id') ?? '',
    resource_type: params.get('resource_type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    limit,
    offset: (page - 1) * limit,
  };
}

export function AdminAuditLogPage() {
  useDocumentTitle('Audit Log');
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const { toast } = useToast();

  const usersQuery = useUsers({ limit: USER_LIST_LIMIT, offset: 0 });
  const userMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const u of usersQuery.data?.users ?? []) out[u.id] = u.username;
    return out;
  }, [usersQuery.data]);

  const filterPayload: AuditFilterState & { limit: number; offset: number } = filters;
  const { data, isLoading, isFetching, refetch, error } = useAuditLog(filterPayload);

  useEffect(() => {
    if (error instanceof ApiError) {
      toast({
        title: 'Audit log alınamadı',
        description: userFriendlyError(error),
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  function applyFilters(next: AuditFilterState) {
    const params = new URLSearchParams(searchParams);
    (['action', 'actor_user_id', 'resource_type', 'from', 'to'] as const).forEach((k) => {
      if (next[k]) params.set(k, next[k]);
      else params.delete(k);
    });
    // Filter değişti → page=1'e dön
    params.set('page', '1');
    if (!params.get('size')) params.set('size', String(filters.limit));
    setSearchParams(params, { replace: false });
  }

  function setPage(nextOffset: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(Math.floor(nextOffset / filters.limit) + 1));
    params.set('size', String(filters.limit));
    setSearchParams(params, { replace: false });
  }

  function setLimit(nextLimit: number) {
    const params = new URLSearchParams(searchParams);
    params.set('size', String(nextLimit));
    params.set('page', '1');
    setSearchParams(params, { replace: false });
  }

  const filterValue: AuditFilterState = {
    action: filters.action,
    actor_user_id: filters.actor_user_id,
    resource_type: filters.resource_type,
    from: filters.from,
    to: filters.to,
  };

  return (
    <div className="h-full overflow-auto p-6">
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-slate-100">Audit Log</CardTitle>
          <CardDescription className="text-slate-400">
            Tüm sistem olaylarını görüntüleyin. Filtreler URL'de saklanır, paylaşılabilir.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Audit log'u yenile"
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuditFilters
          value={filterValue}
          onChange={(next) => {
            // EMPTY_FILTERS shortcut'a da uyar — applyFilters tüm anahtarları siler
            applyFilters(next === EMPTY_FILTERS ? EMPTY_FILTERS : next);
          }}
          users={usersQuery.data?.users ?? []}
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Zaman</TableHead>
              <TableHead className="w-[140px]">Aktör</TableHead>
              <TableHead>İşlem</TableHead>
              <TableHead>Kaynak</TableHead>
              <TableHead className="w-[60px]" aria-label="Detay" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !data
              ? Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))
              : null}

            {data && data.entries.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  Filtre kriterlerine uyan kayıt bulunamadı.
                </TableCell>
              </TableRow>
            ) : null}

            {data?.entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} userMap={userMap} />
            ))}
          </TableBody>
        </Table>

        {data ? (
          <Pagination
            offset={data.offset}
            limit={data.limit}
            total={data.total}
            onPageChange={setPage}
            onLimitChange={setLimit}
            pageSizes={ALLOWED_LIMITS}
          />
        ) : null}
      </CardContent>
    </Card>
    </div>
  );
}

export default AdminAuditLogPage;
