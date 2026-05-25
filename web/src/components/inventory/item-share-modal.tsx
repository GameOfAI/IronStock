/**
 * ItemShareModal — share an item with a user or group (PR-UX5, PR-TIME, PR-GROUP-SHARE).
 *
 * User share flow:
 * 1. Owner's `owner_dek_wrapped` + `owner_wrap_nonce` → openDEKWithKEK → plaintext DEK
 * 2. Fetch recipient's public key via `useUserPublicKey(recipientId)`
 * 3. Seal DEK with recipient's X25519 public key → `sealDEK`
 * 4. POST /items/{id}/shares { user_id, permission, dek_wrapped, wrap_nonce,
 *                              valid_from?, valid_until? }
 *
 * Group share flow:
 * 1. Unwrap owner DEK (same as above)
 * 2. Fetch all current group members via useGroupMembersQuery
 * 3. Fetch each member's public key
 * 4. Seal DEK for each member
 * 5. POST /items/{id}/group-shares { group_id, permission, members: [...], valid_from?, valid_until? }
 */

import { useState } from 'react';
import { Calendar, Loader2, Search, Share2, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUserPublicKey, useUserPublicKeys } from '@/api/catalog';
import { useShareItemMutation, useShareGroupMutation } from '@/api/items';
import { useUsers } from '@/api/admin';
import { useGroupsQuery, useGroupMembersQuery } from '@/api/groups';
import { useAuthStore } from '@/store/auth';
import { fromBase64, toBase64, openDEKWithKEK, sealDEK } from '@/lib/crypto';
import { userFriendlyError } from '@/lib/user-error';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: {
    id: string;
    name: string;
    owner_dek_wrapped?: string;
    owner_wrap_nonce?: string;
  } | null;
}

export function ItemShareModal({ open, onOpenChange, item }: Props) {
  const [tab, setTab] = useState<'user' | 'group'>('user');

  // User share state
  const [recipientId, setRecipientId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [userPermission, setUserPermission] = useState<'read' | 'write'>('read');
  const [userValidFrom, setUserValidFrom] = useState('');
  const [userValidUntil, setUserValidUntil] = useState('');
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Group share state
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupPermission, setGroupPermission] = useState<'read' | 'write'>('read');
  const [groupValidFrom, setGroupValidFrom] = useState('');
  const [groupValidUntil, setGroupValidUntil] = useState('');
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const [error, setError] = useState<string | null>(null);

  const privateKey = useAuthStore((s) => s.privateKey);
  const me = useAuthStore((s) => s.user);

  // User tab data
  const pubKeyQuery = useUserPublicKey(recipientId || null);
  const shareMutation = useShareItemMutation(item?.id ?? '');
  const usersQuery = useUsers({ limit: 200, offset: 0 });

  // Group tab data
  const shareGroupMutation = useShareGroupMutation(item?.id ?? '');
  const groupsQuery = useGroupsQuery();
  const groupMembersQuery = useGroupMembersQuery(groupId);
  const memberIds = (groupMembersQuery.data?.members ?? []).map((m) => m.user_id);
  const memberPublicKeysQuery = useUserPublicKeys(groupId ? memberIds : []);

  const isPending = shareMutation.isPending || shareGroupMutation.isPending;

  const allUsers = usersQuery.data?.users ?? [];
  const filteredUsers = allUsers.filter((u) => {
    if (u.id === me?.id) return false;
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const allGroups = groupsQuery.data?.groups ?? [];
  const filteredGroups = allGroups.filter((g) => {
    if (!groupSearch) return true;
    return g.name.toLowerCase().includes(groupSearch.toLowerCase());
  });

  function handleClose() {
    setTab('user');
    setRecipientId(''); setRecipientName('');
    setUserPermission('read'); setUserValidFrom(''); setUserValidUntil('');
    setUserSearch('');
    setGroupId(''); setGroupName('');
    setGroupPermission('read'); setGroupValidFrom(''); setGroupValidUntil('');
    setGroupSearch('');
    setError(null);
    onOpenChange(false);
  }

  function selectUser(userId: string, username: string) {
    setRecipientId(userId); setRecipientName(username);
    setUserPickerOpen(false); setUserSearch('');
  }

  function selectGroup(gId: string, gName: string) {
    setGroupId(gId); setGroupName(gName);
    setGroupPickerOpen(false); setGroupSearch('');
  }

  // ---- User share submit ----
  async function handleUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!recipientId) { setError('Bir kullanıcı seçin.'); return; }
    if (userValidFrom && userValidUntil && new Date(userValidFrom) >= new Date(userValidUntil)) {
      setError('Başlangıç tarihi bitiş tarihinden önce olmalı.'); return;
    }
    if (!privateKey) { setError('Şifreleme anahtarı bulunamadı. Yeniden giriş yapın.'); return; }
    if (!item?.owner_dek_wrapped || !item?.owner_wrap_nonce) {
      setError('Owner DEK bilgisi mevcut değil. Item detayını yeniden yükleyin.'); return;
    }
    if (!pubKeyQuery.data) { setError("Alıcının public key'i alınamadı."); return; }

    try {
      const dek = await openDEKWithKEK(
        fromBase64(item.owner_dek_wrapped),
        fromBase64(item.owner_wrap_nonce),
        privateKey,
      );
      const recipientPubKey = fromBase64(pubKeyQuery.data.public_key);
      const { wrapped, nonce } = await sealDEK(dek, recipientPubKey);

      await shareMutation.mutateAsync({
        user_id: recipientId,
        permission: userPermission,
        dek_wrapped: toBase64(wrapped),
        wrap_nonce: toBase64(nonce),
        valid_from: userValidFrom ? new Date(userValidFrom).toISOString() : null,
        valid_until: userValidUntil ? new Date(userValidUntil).toISOString() : null,
      });
      handleClose();
    } catch (err) {
      setError(userFriendlyError(err));
    }
  }

  // ---- Group share submit ----
  async function handleGroupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!groupId) { setError('Bir grup seçin.'); return; }
    if (groupValidFrom && groupValidUntil && new Date(groupValidFrom) >= new Date(groupValidUntil)) {
      setError('Başlangıç tarihi bitiş tarihinden önce olmalı.'); return;
    }
    if (!privateKey) { setError('Şifreleme anahtarı bulunamadı. Yeniden giriş yapın.'); return; }
    if (!item?.owner_dek_wrapped || !item?.owner_wrap_nonce) {
      setError('Owner DEK bilgisi mevcut değil. Item detayını yeniden yükleyin.'); return;
    }

    const members = groupMembersQuery.data?.members ?? [];
    if (members.length === 0) {
      setError('Bu grupta henüz üye yok. Önce gruba kullanıcı ekleyin.'); return;
    }

    // Check all public keys are loaded
    const pubKeys = memberPublicKeysQuery.data;
    if (!pubKeys) {
      setError('Grup üyelerinin public keyleri yükleniyor, lütfen bekleyin.'); return;
    }
    const missingKeys = members.filter((m) => !pubKeys[m.user_id]);
    if (missingKeys.length > 0) {
      setError(`${missingKeys.length} üyenin public key'i eksik. Bu kullanıcılar henüz giriş yapmamış olabilir.`);
      return;
    }

    try {
      // Unwrap owner DEK
      const dek = await openDEKWithKEK(
        fromBase64(item.owner_dek_wrapped),
        fromBase64(item.owner_wrap_nonce),
        privateKey,
      );

      // Wrap DEK for each member
      const memberWraps = await Promise.all(
        members.map(async (m) => {
          const memberPubKey = fromBase64(pubKeys[m.user_id]!);
          const { wrapped, nonce } = await sealDEK(dek, memberPubKey);
          return {
            user_id: m.user_id,
            dek_wrapped: toBase64(wrapped),
            wrap_nonce: toBase64(nonce),
          };
        }),
      );

      await shareGroupMutation.mutateAsync({
        group_id: groupId,
        permission: groupPermission,
        members: memberWraps,
        valid_from: groupValidFrom ? new Date(groupValidFrom).toISOString() : null,
        valid_until: groupValidUntil ? new Date(groupValidUntil).toISOString() : null,
      });
      handleClose();
    } catch (err) {
      setError(userFriendlyError(err));
    }
  }

  const timeWindowFields = (
    from: string, setFrom: (v: string) => void,
    until: string, setUntil: (v: string) => void,
  ) => (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm">
        <Calendar className="h-3.5 w-3.5" />
        Erişim Penceresi
        <span className="text-xs text-muted-foreground font-normal">(opsiyonel)</span>
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Başlangıç</Label>
          <Input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={isPending}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Bitiş</Label>
          <Input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            disabled={isPending}
            className="text-xs"
          />
        </div>
      </div>
      {(from || until) && (
        <p className="text-xs text-muted-foreground">
          {from && until
            ? `${new Date(from).toLocaleString('tr-TR')} — ${new Date(until).toLocaleString('tr-TR')}`
            : from
            ? `${new Date(from).toLocaleString('tr-TR')} tarihinden itibaren`
            : `${new Date(until).toLocaleString('tr-TR')} tarihine kadar`}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Item Paylaş — {item?.name}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as 'user' | 'group'); setError(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="user">Kullanıcı</TabsTrigger>
            <TabsTrigger value="group" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Grup
            </TabsTrigger>
          </TabsList>

          {/* ---- User share tab ---- */}
          <TabsContent value="user">
            <form onSubmit={handleUserSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Kullanıcı</Label>
                <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start font-normal"
                      disabled={isPending}
                    >
                      {recipientName ? (
                        <span>{recipientName}</span>
                      ) : (
                        <span className="text-muted-foreground">Kullanıcı seç…</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Kullanıcı ara…"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="h-7 text-xs"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {usersQuery.isLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredUsers.length === 0 ? (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                          Kullanıcı bulunamadı
                        </p>
                      ) : (
                        filteredUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-accent transition-colors"
                            onClick={() => selectUser(u.id, u.username)}
                          >
                            <span className="text-sm font-medium">{u.username}</span>
                            <span className="text-[10px] text-muted-foreground">{u.email}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {pubKeyQuery.isSuccess && recipientId && (
                  <p className="text-xs text-muted-foreground">✓ Public key hazır</p>
                )}
                {pubKeyQuery.isError && recipientId && (
                  <p className="text-xs text-destructive">
                    Public key alınamadı — kullanıcıda anahtar eksik olabilir.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Yetki</Label>
                <Select
                  value={userPermission}
                  onValueChange={(v) => setUserPermission(v as 'read' | 'write')}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Okuma</SelectItem>
                    <SelectItem value="write">Yazma</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {timeWindowFields(userValidFrom, setUserValidFrom, userValidUntil, setUserValidUntil)}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>İptal</Button>
                <Button
                  type="submit"
                  disabled={isPending || !recipientId || pubKeyQuery.isPending}
                >
                  {isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Paylaşılıyor…</>
                  ) : 'Paylaş'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* ---- Group share tab ---- */}
          <TabsContent value="group">
            <form onSubmit={handleGroupSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Grup</Label>
                <Popover open={groupPickerOpen} onOpenChange={setGroupPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start font-normal"
                      disabled={isPending}
                    >
                      {groupName ? (
                        <span>{groupName}</span>
                      ) : (
                        <span className="text-muted-foreground">Grup seç…</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Grup ara…"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        className="h-7 text-xs"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {groupsQuery.isLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredGroups.length === 0 ? (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                          Grup bulunamadı
                        </p>
                      ) : (
                        filteredGroups.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-accent transition-colors"
                            onClick={() => selectGroup(g.id, g.name)}
                          >
                            <span className="text-sm font-medium">{g.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {g.member_count} üye
                              {g.description ? ` · ${g.description}` : ''}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Member count + key status */}
                {groupId && (
                  <div className="text-xs text-muted-foreground">
                    {groupMembersQuery.isLoading ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Üyeler yükleniyor…
                      </span>
                    ) : (
                      <span>
                        {groupMembersQuery.data?.members.length ?? 0} üye
                        {memberPublicKeysQuery.isLoading
                          ? ' · Public keyler yükleniyor…'
                          : memberPublicKeysQuery.data
                          ? ' · ✓ Tüm keyler hazır'
                          : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Yetki</Label>
                <Select
                  value={groupPermission}
                  onValueChange={(v) => setGroupPermission(v as 'read' | 'write')}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Okuma</SelectItem>
                    <SelectItem value="write">Yazma</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {timeWindowFields(groupValidFrom, setGroupValidFrom, groupValidUntil, setGroupValidUntil)}

              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Grup paylaşımında DEK her üye için ayrı wrap edilir. Gruba sonradan
                eklenen kullanıcılar E2E secret alanlara erişmek için ayrıca
                paylaşım yapılmasını gerektirir.
              </p>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>İptal</Button>
                <Button
                  type="submit"
                  disabled={
                    isPending ||
                    !groupId ||
                    groupMembersQuery.isLoading ||
                    memberPublicKeysQuery.isLoading
                  }
                >
                  {isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Paylaşılıyor…</>
                  ) : 'Grupla Paylaş'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
