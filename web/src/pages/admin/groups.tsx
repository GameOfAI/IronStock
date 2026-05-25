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
  useGroupMembersQuery,
  useGroupsQuery,
  useRemoveGroupMemberMutation,
} from '@/api/groups';
import { useUsers } from '@/api/admin';
import type { Group } from '@/api/types';
import { Plus, Trash2, UserMinus, Users } from 'lucide-react';
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

// --- Group Detail Panel ---

function GroupDetailPanel({ group, onDelete }: { group: Group; onDelete: () => void }) {
  const { toast } = useToast();
  const deleteMut = useDeleteGroupMutation();

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
        <div>
          <h2 className="text-lg font-semibold">{group.name}</h2>
          {group.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            <Badge variant="secondary">{group.member_count} üye</Badge>
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
                <Badge variant="secondary" className="ml-2 shrink-0">
                  {g.member_count}
                </Badge>
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
