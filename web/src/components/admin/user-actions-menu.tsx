/**
 * UserActionsMenu — her user satırı için [⋮] dropdown'u.
 *
 * İçerik:
 *   - 3 rol toggle (admin / write / read)  — checkbox tarzı, optimistic
 *   - Devre Dışı / Etkinleştir              — confirm dialog (disable yıkıcı)
 *
 * Self-protection: server engelleyici (kendi admin rolünü revoke + kendi
 * disable). UI tarafında bu maddeler `disabled + tooltip` ile pasif gösterilir.
 */

import { useState } from 'react';
import { Fingerprint, Globe, KeyRound, Loader2, MoreVertical, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  useDisableUserMutation,
  useEnableUserMutation,
  useGrantRoleMutation,
  useResetTOTPMutation,
  useRevokeRoleMutation,
  useSetBreakGlassMutation,
  useUpdateTOTPRequirementMutation,
  useUpdateWebAuthnRequirementMutation,
} from '@/api/admin';
import { useUpdateClientCertRequirementMutation } from '@/api/admin-client-certs';
import { useIPRestrictionsQuery, useUpdateIPRestrictionsMutation } from '@/api/admin-ip-restrictions';
import { useAuthStore } from '@/store/auth';
import type { AdminUser } from '@/api/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DisableConfirmDialog } from './disable-confirm-dialog';
import { userFriendlyError } from '@/lib/user-error';

interface UserActionsMenuProps {
  user: AdminUser;
}

const ALL_ROLES = ['admin', 'write', 'read'] as const;
type Role = (typeof ALL_ROLES)[number];

function describeError(err: unknown): string {
  return userFriendlyError(err);
}

export function UserActionsMenu({ user }: UserActionsMenuProps) {
  const me = useAuthStore((s) => s.user);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [totpResetOpen, setTotpResetOpen] = useState(false);

  const grantRole = useGrantRoleMutation(user.id);
  const revokeRole = useRevokeRoleMutation(user.id);
  const disableUser = useDisableUserMutation(user.id);
  const enableUser = useEnableUserMutation(user.id);
  const resetTotp = useResetTOTPMutation(user.id);
  const updateTotpReq = useUpdateTOTPRequirementMutation(user.id);
  const updateCertReq = useUpdateClientCertRequirementMutation(user.id);
  const updateWebAuthnReq = useUpdateWebAuthnRequirementMutation(user.id);
  const setBreakGlass = useSetBreakGlassMutation(user.id);

  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const ipQuery = useIPRestrictionsQuery(ipDialogOpen ? user.id : '');
  const updateIP = useUpdateIPRestrictionsMutation(user.id);
  const [ipCIDRs, setIpCIDRs] = useState('');
  const [ipCountries, setIpCountries] = useState('');
  const [denyTor, setDenyTor] = useState(false);

  const isSelf = me?.id === user.id;
  const userRoles = new Set(user.roles);

  function toggleRole(role: Role, currentlyHas: boolean) {
    // Self-strip-admin guard — server zaten engelliyor ama UI'de
    // checkbox toggle'ından önce engelle.
    if (isSelf && role === 'admin' && currentlyHas) {
      toast({
        title: 'İzin verilmedi',
        description: 'Kendi admin rolünüzü kaldıramazsınız.',
        variant: 'destructive',
      });
      return;
    }
    const promise = currentlyHas
      ? revokeRole.mutateAsync(role)
      : grantRole.mutateAsync({ role });
    promise.catch((err) => {
      toast({
        title: currentlyHas ? 'Rol kaldırılamadı' : 'Rol atanamadı',
        description: describeError(err),
        variant: 'destructive',
      });
    });
  }

  function handleDisableConfirm() {
    disableUser.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast({ title: 'Kullanıcı devre dışı bırakıldı' });
      },
      onError: (err) => {
        toast({
          title: 'Devre dışı bırakılamadı',
          description: describeError(err),
          variant: 'destructive',
        });
      },
    });
  }

  function handleEnable() {
    enableUser.mutate(undefined, {
      onSuccess: () => toast({ title: 'Kullanıcı etkinleştirildi' }),
      onError: (err) => {
        toast({
          title: 'Etkinleştirilemedi',
          description: describeError(err),
          variant: 'destructive',
        });
      },
    });
  }

  function handleTotpReset() {
    resetTotp.mutate(undefined, {
      onSuccess: () => {
        setTotpResetOpen(false);
        toast({ title: 'TOTP sıfırlandı', description: `${user.username} bir sonraki girişte TOTP'yi yeniden kurmalı.` });
      },
      onError: (err) => {
        toast({
          title: 'TOTP sıfırlanamadı',
          description: describeError(err),
          variant: 'destructive',
        });
      },
    });
  }

  const rolesPending = grantRole.isPending || revokeRole.isPending;
  const statusPending = disableUser.isPending || enableUser.isPending;
  const isDisabled = user.status === 'disabled';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`${user.username} işlemleri`}
          >
            {rolesPending || statusPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Roller</DropdownMenuLabel>
          {ALL_ROLES.map((role) => {
            const has = userRoles.has(role);
            const lockedBySelf = isSelf && role === 'admin' && has;
            const item = (
              <DropdownMenuCheckboxItem
                key={role}
                checked={has}
                disabled={lockedBySelf || rolesPending}
                onSelect={(e) => {
                  // Keep menu open while toggling roles
                  e.preventDefault();
                  if (!lockedBySelf) toggleRole(role, has);
                }}
              >
                <span className="font-mono text-xs">{role}</span>
              </DropdownMenuCheckboxItem>
            );
            if (!lockedBySelf) return item;
            return (
              <TooltipProvider key={role} delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>{item}</div>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Kendi admin rolünüzü kaldıramazsınız.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setTotpResetOpen(true);
            }}
            className="text-amber-600 focus:text-amber-700"
            disabled={isSelf}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            TOTP Sıfırla
          </DropdownMenuItem>
          {/* PR-SEC1: TOTP zorunluluğu toggle. Self için kapatma engelli. */}
          <DropdownMenuCheckboxItem
            checked={user.totp_required}
            disabled={
              updateTotpReq.isPending ||
              (isSelf && user.totp_required) /* admin kendi TOTP'sini kapatamaz */
            }
            onSelect={(e) => {
              e.preventDefault();
              const next = !user.totp_required;
              updateTotpReq.mutate(next, {
                onSuccess: () =>
                  toast({
                    title: next ? 'TOTP zorunlu kılındı' : 'TOTP zorunluluğu kaldırıldı',
                    description: next
                      ? `${user.username} bir sonraki girişte TOTP kurmak zorunda.`
                      : `${user.username} artık sadece şifreyle giriş yapabilir.`,
                  }),
                onError: (err) =>
                  toast({
                    title: 'TOTP zorunluluğu güncellenemedi',
                    description: describeError(err),
                    variant: 'destructive',
                  }),
              });
            }}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            <span>TOTP zorunlu</span>
          </DropdownMenuCheckboxItem>
          {/* PR-SEC3: Client cert (mTLS) zorunluluğu toggle */}
          <DropdownMenuCheckboxItem
            checked={user.requires_client_cert}
            disabled={updateCertReq.isPending}
            onSelect={(e) => {
              e.preventDefault();
              const next = !user.requires_client_cert;
              updateCertReq.mutate(
                { required: next },
                {
                  onSuccess: () =>
                    toast({
                      title: next ? 'Sertifika zorunlu kılındı' : 'Sertifika zorunluluğu kaldırıldı',
                      description: next
                        ? `${user.username} artık istemci sertifikasıyla giriş yapmak zorunda.`
                        : `${user.username} artık sertifikasız giriş yapabilir.`,
                    }),
                  onError: (err) =>
                    toast({
                      title: 'Sertifika zorunluluğu güncellenemedi',
                      description: describeError(err),
                      variant: 'destructive',
                    }),
                },
              );
            }}
          >
            <Fingerprint className="mr-2 h-4 w-4" />
            <span>Sertifika zorunlu</span>
          </DropdownMenuCheckboxItem>
          {/* PR-SEC4: WebAuthn / FIDO2 zorunluluğu toggle */}
          <DropdownMenuCheckboxItem
            checked={user.webauthn_required}
            disabled={updateWebAuthnReq.isPending}
            onSelect={(e) => {
              e.preventDefault();
              const next = !user.webauthn_required;
              updateWebAuthnReq.mutate(next, {
                onSuccess: () =>
                  toast({
                    title: next ? 'WebAuthn zorunlu kılındı' : 'WebAuthn zorunluluğu kaldırıldı',
                    description: next
                      ? `${user.username} artık güvenlik anahtarıyla giriş yapmak zorunda.`
                      : `${user.username} artık güvenlik anahtarı olmadan giriş yapabilir.`,
                  }),
                onError: (err) =>
                  toast({
                    title: 'WebAuthn zorunluluğu güncellenemedi',
                    description: describeError(err),
                    variant: 'destructive',
                  }),
              });
            }}
          >
            <ShieldCheck className="mr-2 h-4 w-4 text-indigo-500" />
            <span>WebAuthn zorunlu</span>
          </DropdownMenuCheckboxItem>
          {/* PR-N4: Break-glass acil erişim toggle — etkinleştirilince tüm adminlere anlık uyarı */}
          <DropdownMenuCheckboxItem
            checked={user.is_break_glass}
            disabled={setBreakGlass.isPending || isSelf}
            onSelect={(e) => {
              e.preventDefault();
              const next = !user.is_break_glass;
              setBreakGlass.mutate(next, {
                onSuccess: () =>
                  toast({
                    title: next ? 'Break-glass etkinleştirildi' : 'Break-glass devre dışı bırakıldı',
                    description: next
                      ? `${user.username} acil erişim modunda. Her girişinde tüm adminler uyarılacak.`
                      : `${user.username} artık normal modda.`,
                    variant: next ? 'destructive' : 'default',
                  }),
                onError: (err) =>
                  toast({
                    title: 'Break-glass güncellenemedi',
                    description: describeError(err),
                    variant: 'destructive',
                  }),
              });
            }}
          >
            <ShieldAlert className="mr-2 h-4 w-4 text-red-500" />
            <span>Break-glass (acil)</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {/* PR-SEC5: IP kısıtlamaları */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              // Pre-fill from server data if available
              if (ipQuery.data) {
                setIpCIDRs(ipQuery.data.allowed_ip_cidrs.join(', '));
                setIpCountries(ipQuery.data.allowed_country_codes.join(', '));
                setDenyTor(ipQuery.data.deny_tor_exit);
              }
              setIpDialogOpen(true);
            }}
          >
            <Globe className="mr-2 h-4 w-4" />
            IP Kısıtlamaları…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isDisabled ? (
            <DropdownMenuItem onSelect={handleEnable} disabled={statusPending || isSelf}>
              Etkinleştir
            </DropdownMenuItem>
          ) : isSelf ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuItem disabled className="text-red-600">
                      Devre Dışı Bırak…
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Kendi hesabınızı devre dışı bırakamazsınız.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setConfirmOpen(true);
              }}
              className="text-red-600 focus:text-red-700"
              disabled={statusPending}
            >
              Devre Dışı Bırak…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DisableConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        username={user.username}
        onConfirm={handleDisableConfirm}
        isPending={disableUser.isPending}
      />

      {/* TOTP Reset confirmation dialog */}
      <AlertDialog open={totpResetOpen} onOpenChange={setTotpResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>TOTP Sıfırla</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{user.username}</strong> kullanıcısının TOTP ayarları sıfırlanacak.
              Bir sonraki girişte yeniden kurması gerekecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTotpReset}
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={resetTotp.isPending}
            >
              {resetTotp.isPending ? 'Sıfırlanıyor…' : 'Sıfırla'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PR-SEC5: IP restrictions dialog */}
      <Dialog open={ipDialogOpen} onOpenChange={(o) => { if (!o) setIpDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              IP Kısıtlamaları — {user.username}
            </DialogTitle>
            <DialogDescription>
              Boş bırakılan alanlar kısıtlama uygulamaz (tüm IP / ülkelere izin verilir).
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cidrs = ipCIDRs.split(',').map((s) => s.trim()).filter(Boolean);
              const countries = ipCountries.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
              updateIP.mutate(
                { allowed_ip_cidrs: cidrs, allowed_country_codes: countries, deny_tor_exit: denyTor },
                {
                  onSuccess: () => {
                    toast({ title: 'IP kısıtlamaları güncellendi.' });
                    setIpDialogOpen(false);
                  },
                  onError: (err) =>
                    toast({
                      title: 'Güncellenemedi',
                      description: describeError(err),
                      variant: 'destructive',
                    }),
                },
              );
            }}
            className="space-y-4 pt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="ip-cidrs">İzin Verilen IP/CIDR (virgülle ayrılmış)</Label>
              <Input
                id="ip-cidrs"
                value={ipCIDRs}
                onChange={(e) => setIpCIDRs(e.target.value)}
                placeholder="192.168.1.0/24, 10.0.0.0/8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-countries">İzin Verilen Ülkeler (ISO 3166-1, virgülle ayrılmış)</Label>
              <Input
                id="ip-countries"
                value={ipCountries}
                onChange={(e) => setIpCountries(e.target.value)}
                placeholder="TR, DE, US"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="deny-tor"
                checked={denyTor}
                onCheckedChange={(v: boolean) => setDenyTor(v)}
              />
              <Label htmlFor="deny-tor">Tor çıkış node'larını reddet</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIpDialogOpen(false)}>
                İptal
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500"
                disabled={updateIP.isPending}
              >
                {updateIP.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
