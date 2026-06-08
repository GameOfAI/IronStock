/**
 * Admin Grup Yönetimi — PR-F6a.
 *
 * Sekmeler: Grup listesi → Grup detayı (üyeler + klasör izinleri).
 *
 * Sol panel: grup listesi + oluşturma.
 * Sağ panel: seçili grubun üyeleri ve folder izinleri.
 */

import * as React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  useAddGroupMemberMutation,
  useCreateGroupMutation,
  useDeleteGroupMutation,
  useGroupFolderPermissionsQuery,
  useGroupMembersQuery,
  useGrantFolderGroupPermissionMutation,
  useGroupsQuery,
  useRemoveGroupMemberMutation,
  useRevokeFolderGroupPermissionMutation,
  useUpdateGroupRoleMutation,
} from '@/api/groups';
import { useUsers } from '@/api/admin';
import { useRootFolders } from '@/api/folders';
import type { Group } from '@/api/types';
import { FolderOpen, Plus, Shield, Trash2, UserMinus, Users } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

// --- Create Group Dialog ---

function CreateGroupDialog() {
  const { toast } = useToast();
  const createMut = useCreateGroupMutation();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createMut.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      toast({ title: 'Grup oluşturuldu', description: name.trim() });
      setOpen(false);
      setName('');
      setDescription('');
    } catch (err) {
      toast({
        title: 'Grup oluşturulamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Yeni Grup
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Grup Oluştur</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grp-name">Ad *</Label>
            <Input
              id="grp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ops, DevTeam, …"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grp-desc">Açıklama</Label>
            <Input
              id="grp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opsiyonel"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Group Members Panel ---

function GroupMembersPanel({ group }: { group: Group }) {
  const { toast } = useToast();
  const { data } = useGroupMembersQuery(group.id);
  const { data: usersData } = useUsers({ limit: 200, offset: 0 });
  const addMut = useAddGroupMemberMutation(group.id);
  const removeMut = useRemoveGroupMemberMutation(group.id);
  const [selectedUserId, setSelectedUserId] = React.useState('');

  const members = data?.members ?? [];
  const memberIds = new Set(members.map((m) => m.user_id));
  const availableUsers = (usersData?.users ?? []).filter((u) => !memberIds.has(u.id));

  async function handleAdd() {
    if (!selectedUserId) return;
    try {
      await addMut.mutateAsync({ user_id: selectedUserId });
      setSelectedUserId('');
      toast({ title: 'Üye eklendi' });
    } catch (err) {
      toast({
        title: 'Üye eklenemedi',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  async function handleRemove(userId: string, username: string) {
    try {
      await removeMut.mutateAsync(userId);
      toast({ title: 'Üye çıkarıldı', description: username });
    } catch (err) {
      toast({
        title: 'Üye çıkarılamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add member */}
      <div className="flex gap-2">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Kullanıcı seç…" />
          </SelectTrigger>
          <SelectContent>
            {availableUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!selectedUserId || addMut.isPending}
        >
          Ekle
        </Button>
      </div>

      {/* Member list */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu grupta henüz üye yok.</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-mono">{m.username}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(m.user_id, m.username)}
                aria-label={`${m.username} kullanıcısını çıkar`}
              >
                <UserMinus className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Group Folder Permissions Panel ---

function GroupFolderPermissionsPanel({ group }: { group: Group }) {
  const { toast } = useToast();
  const { data } = useGroupFolderPermissionsQuery(group.id);
  const { data: rootFolders } = useRootFolders();
  const grantMut = useGrantFolderGroupPermissionMutation(group.id);
  const revokeMut = useRevokeFolderGroupPermissionMutation(group.id);

  const [selectedFolderId, setSelectedFolderId] = React.useState('');
  const [permission, setPermission] = React.useState<'read' | 'write'>('read');
  const [inherit, setInherit] = React.useState(true);

  const permissions = data?.permissions ?? [];
  const folders = rootFolders?.folders ?? [];

  async function handleGrant() {
    if (!selectedFolderId) return;
    try {
      await grantMut.mutateAsync({ folder_id: selectedFolderId, permission, inherit_to_children: inherit });
      setSelectedFolderId('');
      toast({ title: 'Klasör izni verildi' });
    } catch (err) {
      toast({ title: 'İzin verilemedi', description: userFriendlyError(err), variant: 'destructive' });
    }
  }

  async function handleRevoke(folderId: string, folderName: string) {
    try {
      await revokeMut.mutateAsync(folderId);
      toast({ title: 'İzin kaldırıldı', description: folderName });
    } catch (err) {
      toast({ title: 'İzin kaldırılamadı', description: userFriendlyError(err), variant: 'destructive' });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Grant new permission */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Yeni İzin Ekle</p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <Label className="text-xs">Klasör</Label>
            <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Klasör seç…" />
              </SelectTrigger>
              <SelectContent>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">İzin</Label>
            <Select value={permission} onValueChange={(v) => setPermission(v as 'read' | 'write')}>
              <SelectTrigger className="h-8 text-sm w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Okuma</SelectItem>
                <SelectItem value="write">Yazma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5 pb-0.5">
            <input
              type="checkbox"
              id="inherit-check"
              checked={inherit}
              onChange={(e) => setInherit(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <Label htmlFor="inherit-check" className="text-xs cursor-pointer">Alt klasörlere yay</Label>
          </div>
          <Button
            size="sm"
            className="h-8"
            onClick={handleGrant}
            disabled={!selectedFolderId || grantMut.isPending}
          >
            {grantMut.isPending ? 'Ekleniyor…' : 'Ekle'}
          </Button>
        </div>
      </div>

      {/* Current permissions list */}
      {permissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu gruba henüz klasör izni verilmemiş.</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {permissions.map((p) => (
            <div key={p.folder_id} className="flex items-center justify-between px-3 py-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{p.folder_name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant="outline"
                  className={p.permission === 'write'
                    ? 'text-blue-400 border-blue-500/30'
                    : 'text-green-400 border-green-500/30'}
                >
                  {p.permission === 'write' ? 'Yazma' : 'Okuma'}
                </Badge>
                {p.inherit_to_children && (
                  <Badge variant="secondary" className="text-xs">Alt klasörler</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRevoke(p.folder_id, p.folder_name)}
                  aria-label={`${p.folder_name} iznini kaldır`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Group Detail Panel ---

// Role badge colours matching roles.tsx
const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  write: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  read: 'bg-green-500/15 text-green-300 border-green-500/30',
};
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', write: 'Yazma', read: 'Okuma' };

function GroupDetailPanel({ group, onDelete }: { group: Group; onDelete: () => void }) {
  const { toast } = useToast();
  const deleteMut = useDeleteGroupMutation();
  const roleMut = useUpdateGroupRoleMutation(group.id);
  const [pendingRole, setPendingRole] = React.useState<string>(group.role ?? '');

  // Sync local state when selected group changes
  React.useEffect(() => { setPendingRole(group.role ?? ''); }, [group.id, group.role]);

  async function handleRoleChange(value: string) {
    setPendingRole(value);
    try {
      await roleMut.mutateAsync({ role: value === '' ? null : value as 'admin' | 'write' | 'read' });
      toast({ title: value ? `Rol atandı: ${ROLE_LABELS[value]}` : 'Rol kaldırıldı' });
    } catch (err) {
      setPendingRole(group.role ?? '');
      toast({ title: 'Rol güncellenemedi', description: userFriendlyError(err), variant: 'destructive' });
    }
  }

  async function handleDelete() {
    try {
      await deleteMut.mutateAsync(group.id);
      toast({ title: 'Grup silindi', description: group.name });
      onDelete();
    } catch (err) {
      toast({
        title: 'Grup silinemedi',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{group.name}</h2>
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge variant="secondary">{group.member_count} üye</Badge>
            {group.role && (
              <Badge variant="outline" className={ROLE_BADGE[group.role]}>
                {ROLE_LABELS[group.role]}
              </Badge>
            )}
          </div>
          {/* Role assignment inline */}
          <div className="flex items-center gap-2 mt-1">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Grup rolü:</Label>
            <Select
              value={pendingRole}
              onValueChange={handleRoleChange}
              disabled={roleMut.isPending}
            >
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="Rol yok" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Rol yok</SelectItem>
                <SelectItem value="read">Okuma</SelectItem>
                <SelectItem value="write">Yazma</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {roleMut.isPending && (
              <span className="text-xs text-muted-foreground">Kaydediliyor…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground max-w-xs">
            Seçilen rol, gruptaki tüm üyelere bir sonraki token yenilemesinde uygulanır.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="h-4 w-4" />
              Sil
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Grubu sil</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{group.name}</strong> grubu ve tüm üyelikleri silinecek.
                Klasör izinleri de kaldırılır. Bu işlem geri alınamaz.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>İptal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Sil
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Üyeler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GroupMembersPanel group={group} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Klasör İzinleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GroupFolderPermissionsPanel group={group} />
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Page ---

export default function AdminGroupsPage() {
  useDocumentTitle('Gruplar');
  const { data, isLoading } = useGroupsQuery();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const groups = data?.groups ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="flex gap-6 h-full">
      {/* Left: group list */}
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Gruplar</h1>
          <CreateGroupDialog />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz grup yok.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedId(g.id)}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  selectedId === g.id ? 'bg-accent font-medium' : 'text-muted-foreground'
                }`}
              >
                <span className="truncate">{g.name}</span>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {g.role && (
                    <Badge variant="outline" className={`text-xs ${ROLE_BADGE[g.role]}`}>
                      {ROLE_LABELS[g.role]}
                    </Badge>
                  )}
                  <Badge variant="secondary">{g.member_count}</Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: group detail */}
      <div className="flex-1">
        {selectedGroup ? (
          <GroupDetailPanel
            group={selectedGroup}
            onDelete={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">Detay görmek için bir grup seçin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
