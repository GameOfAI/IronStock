/**
 * /admin/users — Unified admin management page with tabs (PR-UX3).
 *
 * Tabs: Kullanıcılar | Gruplar | Roller
 * Tab state syncs with URL `?tab=users|groups|roles` for bookmarkability.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCcw, UserPlus } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useUsers } from '@/api/admin';
import { ApiError } from '@/api/errors';
import { UserTable } from '@/components/admin/user-table';
import { Pagination } from '@/components/common/pagination';
import { CreateUserModal } from '@/components/admin/create-user-modal';

// Lazy-load groups and roles tabs
const AdminGroupsTab = lazy(() => import('./groups'));
const AdminRolesTab = lazy(() => import('./roles'));

const DEFAULT_LIMIT = 50;
const ALLOWED_LIMITS = [25, 50, 100];

const VALID_TABS = ['users', 'groups', 'roles'] as const;
type TabValue = (typeof VALID_TABS)[number];

function parsePagination(params: URLSearchParams): { limit: number; offset: number } {
  const sizeRaw = Number(params.get('size'));
  const limit = ALLOWED_LIMITS.includes(sizeRaw) ? sizeRaw : DEFAULT_LIMIT;
  const pageRaw = Number(params.get('page'));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  return { limit, offset: (page - 1) * limit };
}

// --- Users Tab Content (inlined) ---

function UsersTabContent() {
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
    <>
      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
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
          <UserTable users={data?.users} isLoading={isLoading} />
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
    </>
  );
}

// --- Main Page ---

export default function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab') ?? 'users';
  const activeTab: TabValue = VALID_TABS.includes(tabParam as TabValue)
    ? (tabParam as TabValue)
    : 'users';

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    // Clear pagination when switching tabs
    next.delete('page');
    next.delete('size');
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Kullanıcı Yönetimi</h1>
        <p className="text-sm text-muted-foreground">
          Kullanıcılar, gruplar ve roller tek bir yerden yönetin.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="users">Kullanıcılar</TabsTrigger>
          <TabsTrigger value="groups">Gruplar</TabsTrigger>
          <TabsTrigger value="roles">Roller</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersTabContent />
        </TabsContent>

        <TabsContent value="groups">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AdminGroupsTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="roles">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AdminRolesTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
