/**
 * /admin/users — Admin kullanıcı yönetimi sayfası.
 * Ported from web/src/pages/admin/users.tsx (Kullanıcılar tab only — groups/roles TBD).
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCcw, UserPlus } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useUsers } from '@/api/admin';
import { ApiError } from '@/api/errors';
import { UserTable } from '@/components/admin/user-table';
import { Pagination } from '@/components/common/pagination';
import { CreateUserModal } from '@/components/admin/create-user-modal';

const DEFAULT_LIMIT = 50;
const ALLOWED_LIMITS = [25, 50, 100];

function parsePagination(params: URLSearchParams): { limit: number; offset: number } {
  const sizeRaw = Number(params.get('size'));
  const limit = ALLOWED_LIMITS.includes(sizeRaw) ? sizeRaw : DEFAULT_LIMIT;
  const pageRaw = Number(params.get('page'));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  return { limit, offset: (page - 1) * limit };
}

export default function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { limit, offset } = parsePagination(searchParams);
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isFetching, refetch, error } = useUsers({ limit, offset });

  useEffect(() => {
    if (error instanceof ApiError) {
      toast({
        title: 'Kullanıcı listesi alınamadı',
        description: error.message,
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const setPage = (nextOffset: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(Math.floor(nextOffset / limit) + 1));
    next.set('size', String(limit));
    setSearchParams(next, { replace: false });
  };

  const setLimit = (nextLimit: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('size', String(nextLimit));
    next.set('page', '1');
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="h-full overflow-auto p-6">
      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Kullanıcı Yönetimi</h1>
          <p className="text-[13px] text-muted-foreground">
            Kullanıcıları yönetin, roller atayın ve hesapları kontrol edin.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Kullanıcılar</CardTitle>
              <CardDescription>
                Kullanıcı rollerini düzenleyin ve hesapları devre dışı bırakın.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Kullanıcı Oluştur
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Listeyi yenile"
              >
                <RefreshCcw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                Yenile
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && !data ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <UserTable users={data?.users} isLoading={isLoading} />
            )}
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
    </div>
  );
}
