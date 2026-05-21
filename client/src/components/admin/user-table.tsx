/**
 * UserTable — admin kullanıcı listesi tablosu.
 * Ported from web/src/components/admin/user-table.tsx.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdminUser } from '@/api/types';
import { StatusBadge } from './status-badge';
import { RoleBadges } from './role-badges';
import { UserActionsMenu } from './user-actions-menu';
import { RelativeTime } from '@/components/common/relative-time';

interface UserTableProps {
  users: AdminUser[] | undefined;
  isLoading: boolean;
}

const SKELETON_ROW_COUNT = 5;

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-40" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-8 w-8 rounded" />
      </TableCell>
    </TableRow>
  );
}

export function UserTable({ users, isLoading }: UserTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kullanıcı</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Durum</TableHead>
          <TableHead>Roller</TableHead>
          <TableHead>Son Giriş</TableHead>
          <TableHead className="w-[60px]" aria-label="İşlemler" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && !users
          ? Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => <SkeletonRow key={i} />)
          : null}

        {users && users.length === 0 && !isLoading ? (
          <TableRow>
            <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
              Hiç kullanıcı bulunamadı.
            </TableCell>
          </TableRow>
        ) : null}

        {users?.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">{user.username}</TableCell>
            <TableCell className="text-muted-foreground">{user.email}</TableCell>
            <TableCell>
              <StatusBadge status={user.status} />
            </TableCell>
            <TableCell>
              <RoleBadges roles={user.roles} />
            </TableCell>
            <TableCell>
              <RelativeTime iso={user.last_login_at ?? null} fallback="Hiç giriş yapmadı" />
            </TableCell>
            <TableCell className="text-right">
              <UserActionsMenu user={user} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
