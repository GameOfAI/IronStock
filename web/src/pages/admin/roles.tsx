/**
 * /admin/roles — Rol Yönetimi sayfası.
 *
 * Sistemdeki rolleri (admin/write/read) tanımları ve kullanıcı
 * dağılımlarıyla gösterir. Bir kullanıcıdan rol kaldırma işlemi
 * doğrudan bu sayfadan yapılabilir.
 */

import * as React from 'react';
import { RefreshCcw, Shield, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useUsers, useRevokeRoleMutation } from '@/api/admin';
import { ApiError } from '@/api/errors';
import { RelativeTime } from '@/components/common/relative-time';
import type { AdminUser } from '@/api/types';

// ---------- Sabit rol tanımları (DB seed: migrations/00003_roles.sql) ----------

const ROLE_DEFS = [
  {
    name: 'admin',
    label: 'Admin',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    description:
      'Tüm kullanıcıları yönetebilir, rolleri atayabilir ve audit logları görüntüleyebilir.',
    permissions: [
      'Kullanıcı oluşturma / devre dışı bırakma',
      'Rol atama / kaldırma',
      'Audit log görüntüleme',
      'Tüm klasör ve öğelere erişim',
    ],
  },
  {
    name: 'write',
    label: 'Yazma',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    description: 'Yetki verilen klasör ve öğelerde tam CRUD erişimi sağlar.',
    permissions: [
      'Klasör oluşturma / düzenleme / silme',
      'Öğe oluşturma / düzenleme / silme',
      'Öğe paylaşımı',
    ],
  },
  {
    name: 'read',
    label: 'Okuma',
    badgeClass: 'bg-green-500/15 text-green-300 border-green-500/30',
    description: 'Yetki verilen klasör ve öğeleri yalnızca görüntüleyebilir.',
    permissions: ['Klasör görüntüleme', 'Öğe görüntüleme', 'Şifreli alanları okuma'],
  },
] as const;

type RoleDef = (typeof ROLE_DEFS)[number];

// ---------- RoleUserCard — her rol için ayrı kart ----------

interface RoleUserCardProps {
  role: RoleDef;
  users: AdminUser[];
  isLoading: boolean;
  onRefetch: () => void;
}

function RoleUserCard({ role, users, isLoading, onRefetch }: RoleUserCardProps) {
  const { toast } = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  // Hook'lar sabit olmalı — pendingId hook'a geçilmiyor, mutate çağrısında userId kullanılıyor
  const revokeMut = useRevokeRoleMutation(pendingId ?? 'noop');

  async function handleRevoke(userId: string) {
    setPendingId(userId);
    try {
      await revokeMut.mutateAsync(role.name);
      toast({ title: `'${role.label}' rolü kaldırıldı` });
      onRefetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Hata oluştu.';
      toast({ title: 'Rol kaldırılamadı', description: msg, variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <CardTitle className="text-base">{role.label}</CardTitle>
              <Badge variant="outline" className={`text-xs ${role.badgeClass}`}>
                {role.name}
              </Badge>
              {!isLoading && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  <Users className="mr-1 h-3 w-3" />
                  {users.length} kullanıcı
                </Badge>
              )}
            </div>
            <CardDescription>{role.description}</CardDescription>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {role.permissions.map((p) => (
                <span key={p} className="text-xs bg-muted text-muted-foreground rounded px-2 py-0.5">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Bu rolle henüz kullanıcı yok.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>E-posta</TableHead>
                <TableHead>Son Giriş</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                  <TableCell>
                    <RelativeTime iso={u.last_login_at ?? null} fallback="—" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive text-xs h-7"
                      onClick={() => handleRevoke(u.id)}
                      disabled={revokeMut.isPending && pendingId === u.id}
                    >
                      {revokeMut.isPending && pendingId === u.id ? 'Kaldırılıyor…' : 'Rolü Kaldır'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Sayfa ----------

export default function AdminRolesPage() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch, error } = useUsers({ limit: 200, offset: 0 });

  React.useEffect(() => {
    if (error instanceof ApiError) {
      toast({
        title: 'Kullanıcı listesi alınamadı',
        description: error.message,
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const allUsers = data?.users ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Rol Yönetimi</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sistem rolleri, yetki tanımları ve kullanıcı dağılımı.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </div>

      <div className="space-y-4">
        {ROLE_DEFS.map((role) => (
          <RoleUserCard
            key={role.name}
            role={role}
            users={allUsers.filter((u) => u.roles.includes(role.name))}
            isLoading={isLoading}
            onRefetch={refetch}
          />
        ))}
      </div>
    </div>
  );
}
