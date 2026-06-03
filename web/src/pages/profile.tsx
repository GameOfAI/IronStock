/**
 * Kullanıcı Profil Sayfası — PR-F2a.
 *
 * Sekmeler:
 *   - TOTP Yönetimi: durum görüntüleme, devre dışı bırakma, recovery code yenileme.
 *
 * Gelecek PR'larda bu sayfaya güvenilir cihazlar (PR-F2b) ve diğer profil
 * ayarları eklenecek.
 */

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  totpStatusQueryKey,
  useTOTPDisableMutation,
  useTOTPRegenerateBackupMutation,
  useTOTPStatusQuery,
  useTrustedDevicesQuery,
  useRevokeTrustedDeviceMutation,
  useRevokeAllTrustedDevicesMutation,
} from '@/api/auth';
import {
  useWebAuthnCredentials,
  useWebAuthnRegisterBeginMutation,
  useWebAuthnRegisterFinishMutation,
  useWebAuthnUpdateCredentialMutation,
  useWebAuthnDeleteCredentialMutation,
} from '@/api/webauthn';
import { registerSecurityKey, isWebAuthnSupported } from '@/lib/webauthn';
import {
  useNotificationPrefsQuery,
  useUpdateNotificationPrefsMutation,
  useExternalChannelsQuery,
  useAddExternalChannelMutation,
  useDeleteExternalChannelMutation,
  useTestExternalChannelMutation,
  type NotificationType,
  type NotificationChannel,
  type NotificationPref,
} from '@/api/notifications';
import { useAuthStore } from '@/store/auth';
import {
  ShieldCheck,
  ShieldOff,
  RefreshCw,
  Copy,
  CheckCheck,
  Laptop,
  Trash2,
  Bell,
  Plus,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  Key,
  Pencil,
} from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

// --- Recovery Codes Display ---

function RecoveryCodesBox({ codes }: { codes: string[] }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border bg-muted p-3 font-mono text-sm">
        {codes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="self-start gap-2" onClick={handleCopy}>
        {copied ? (
          <>
            <CheckCheck className="h-4 w-4 text-green-500" />
            Kopyalandı
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            Tümünü Kopyala
          </>
        )}
      </Button>
    </div>
  );
}

// --- TOTP Disable Section ---

function TOTPDisableSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const disableMut = useTOTPDisableMutation();
  const [password, setPassword] = React.useState('');
  const [open, setOpen] = React.useState(false);

  async function handleDisable() {
    if (!password) return;
    try {
      await disableMut.mutateAsync({ master_password: password });
      await qc.invalidateQueries({ queryKey: totpStatusQueryKey });
      toast({ title: '2FA devre dışı bırakıldı', description: 'TOTP kimlik doğrulaması kaldırıldı.' });
      setOpen(false);
      setPassword('');
    } catch (err) {
      toast({
        title: '2FA kaldırılamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-2">
          <ShieldOff className="h-4 w-4" />
          2FA'yı Devre Dışı Bırak
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>2FA'yı kaldır</AlertDialogTitle>
          <AlertDialogDescription>
            Bu işlem TOTP kimlik doğrulamayı kaldırır. Hesabınız yalnızca şifreyle korunacak.
            Onaylamak için mevcut master parolanızı girin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="dis-pw">Master Parola</Label>
          <Input
            id="dis-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPassword('')}>İptal</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisable}
            disabled={!password || disableMut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {disableMut.isPending ? 'İşleniyor...' : "2FA'yı Kaldır"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Backup Code Regeneration Section ---

function TOTPBackupRegenerateSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const regenMut = useTOTPRegenerateBackupMutation();
  const [totpCode, setTotpCode] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [newCodes, setNewCodes] = React.useState<string[]>([]);

  async function handleRegenerate() {
    if (totpCode.length < 6) return;
    try {
      const res = await regenMut.mutateAsync({ totp_code: totpCode });
      setNewCodes(res.recovery_codes);
      await qc.invalidateQueries({ queryKey: totpStatusQueryKey });
      toast({ title: 'Recovery code\'lar yenilendi', description: 'Eski kodlar artık geçersiz.' });
      setTotpCode('');
    } catch (err) {
      toast({
        title: 'Yenileme başarısız',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  if (newCodes.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          ✓ Yeni recovery code'lar oluşturuldu. Güvenli bir yere kaydedin — bir daha gösterilmeyecek.
        </p>
        <RecoveryCodesBox codes={newCodes} />
        <Button variant="outline" size="sm" className="self-start" onClick={() => setNewCodes([])}>
          Kapat
        </Button>
      </div>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Recovery Code'ları Yenile
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recovery Code'ları Yenile</AlertDialogTitle>
          <AlertDialogDescription>
            Mevcut tüm recovery code'lar silinir ve 10 yeni kod oluşturulur. Onaylamak için
            kimlik doğrulama kodunuzu girin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="regen-totp">2FA Kodu</Label>
          <Input
            id="regen-totp"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={8}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setTotpCode('')}>İptal</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRegenerate}
            disabled={totpCode.length < 6 || regenMut.isPending}
          >
            {regenMut.isPending ? 'İşleniyor...' : 'Yenile'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- TOTP Management Card ---

function TOTPManagementCard() {
  const { data, isLoading, isError } = useTOTPStatusQuery();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>İki Faktörlü Kimlik Doğrulama</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Yükleniyor...</p>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>İki Faktörlü Kimlik Doğrulama</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">TOTP durumu alınamadı.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {data.enabled ? (
            <ShieldCheck className="h-5 w-5 text-green-500" />
          ) : (
            <ShieldOff className="h-5 w-5 text-muted-foreground" />
          )}
          İki Faktörlü Kimlik Doğrulama
        </CardTitle>
        <CardDescription>
          {data.enabled
            ? 'Hesabınız TOTP ile korunuyor.'
            : 'Hesabınızda 2FA aktif değil.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Durum:</span>
          {data.enabled ? (
            <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
              Aktif
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Pasif
            </Badge>
          )}
        </div>

        {data.enabled && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Kalan Recovery Code:</span>
            <Badge
              variant={data.recovery_code_count <= 2 ? 'destructive' : 'secondary'}
            >
              {data.recovery_code_count}
            </Badge>
            {data.recovery_code_count <= 2 && (
              <span className="text-xs text-destructive">Az kaldı! Yenilemenizi öneririz.</span>
            )}
          </div>
        )}

        {data.enabled && (
          <div className="flex flex-wrap gap-2">
            <TOTPBackupRegenerateSection />
            <TOTPDisableSection />
          </div>
        )}

        {!data.enabled && (
          <p className="text-sm text-muted-foreground">
            2FA etkinleştirmek için çıkış yapıp tekrar kayıt olun veya yöneticinizle iletişime geçin.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Trusted Devices Card (PR-F2b) ---

function TrustedDevicesCard() {
  const { data, isLoading } = useTrustedDevicesQuery();
  const revokeMut = useRevokeTrustedDeviceMutation();
  const revokeAllMut = useRevokeAllTrustedDevicesMutation();
  const { toast } = useToast();

  const devices = data?.devices ?? [];

  async function handleRevoke(id: string) {
    try {
      await revokeMut.mutateAsync(id);
      toast({ title: 'Cihaz kaldırıldı', description: 'Güvenilir cihaz iptal edildi.' });
    } catch (err) {
      toast({
        title: 'Cihaz kaldırılamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  async function handleRevokeAll() {
    try {
      await revokeAllMut.mutateAsync();
      toast({ title: 'Tüm cihazlar kaldırıldı', description: 'Güvenilir cihaz listesi temizlendi.' });
    } catch (err) {
      toast({
        title: 'Cihazlar kaldırılamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Laptop className="h-5 w-5" />
          Güvenilir Cihazlar
        </CardTitle>
        <CardDescription>
          "Beni 30 gün hatırla" seçeneğiyle giriş yapılan cihazlar. Bu cihazlardan 2FA kodu
          istenmez.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor...</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıtlı güvenilir cihaz yok.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {devices.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium line-clamp-1">{d.device_label ?? 'Bilinmeyen cihaz'}</span>
                  <span className="text-xs text-muted-foreground">
                    Son kullanım:{' '}
                    {new Date(d.last_used_at).toLocaleString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Geçerlilik:{' '}
                    {new Date(d.expires_at).toLocaleString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={revokeMut.isPending}
                  onClick={() => handleRevoke(d.id)}
                  aria-label="Cihazı kaldır"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {devices.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="self-start gap-2 text-destructive hover:text-destructive"
                disabled={revokeAllMut.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Tüm Cihazları Kaldır
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Tüm güvenilir cihazları kaldır</AlertDialogTitle>
                <AlertDialogDescription>
                  Bu işlem tüm kayıtlı güvenilir cihazları siler. Bir sonraki girişinizde 2FA
                  kodu tekrar istenecek.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRevokeAll}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Tümünü Kaldır
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

// --- Notification Prefs Card (PR-NOTIFY) ---

const NOTIFICATION_TYPES: { key: NotificationType; label: string }[] = [
  { key: 'access_request', label: 'Erişim Talepleri' },
  { key: 'share_added', label: 'Paylaşım Bildirimleri' },
  { key: 'credential_expiring', label: 'Credential Bitiş Uyarısı' },
  { key: 'security_alert', label: 'Güvenlik Uyarıları' },
  { key: 'mention', label: 'Bahsetmeler' },
  { key: 'system_announcement', label: 'Sistem Duyuruları' },
  { key: 'break_glass_alert', label: 'Break-Glass Alarmları' },
];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inapp: 'Uygulama İçi',
  email: 'E-posta',
  slack: 'Slack',
  teams: 'Teams',
};

const ALL_CHANNELS: NotificationChannel[] = ['inapp', 'email', 'slack', 'teams'];

function NotificationPrefsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useNotificationPrefsQuery();
  const updateMut = useUpdateNotificationPrefsMutation();

  // Local copy — track unsaved changes
  const [localPrefs, setLocalPrefs] = React.useState<NotificationPref[]>([]);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (data?.prefs) {
      setLocalPrefs(data.prefs);
      setDirty(false);
    }
  }, [data]);

  function isEnabled(type: NotificationType, channel: NotificationChannel) {
    const pref = localPrefs.find((p) => p.notification_type === type);
    return pref?.channels.includes(channel) ?? (channel === 'inapp');
  }

  function toggle(type: NotificationType, channel: NotificationChannel) {
    setLocalPrefs((prev) => {
      const existing = prev.find((p) => p.notification_type === type);
      if (!existing) {
        return [...prev, { notification_type: type, channels: [channel] }];
      }
      const channels = existing.channels.includes(channel)
        ? existing.channels.filter((c) => c !== channel)
        : [...existing.channels, channel];
      return prev.map((p) =>
        p.notification_type === type ? { ...p, channels } : p,
      );
    });
    setDirty(true);
  }

  function handleSave() {
    updateMut.mutate(localPrefs, {
      onSuccess: () => {
        setDirty(false);
        toast({ title: 'Tercihler kaydedildi.' });
      },
      onError: (err) => {
        toast({
          title: 'Kaydedilemedi',
          description: userFriendlyError(err),
          variant: 'destructive',
        });
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Bildirim Tercihleri</CardTitle>
        </div>
        <CardDescription>Hangi bildirimleri hangi kanaldan almak istediğinizi seçin.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Tercihler yükleniyor...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Matrix table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 text-left font-medium text-muted-foreground">Bildirim Tipi</th>
                    {ALL_CHANNELS.map((ch) => (
                      <th key={ch} className="pb-2 text-center font-medium text-muted-foreground">
                        {CHANNEL_LABELS[ch]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_TYPES.map(({ key, label }) => (
                    <tr key={key} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-sm">{label}</td>
                      {ALL_CHANNELS.map((ch) => (
                        <td key={ch} className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isEnabled(key, ch)}
                            onChange={() => toggle(key, ch)}
                            className="h-4 w-4 cursor-pointer accent-indigo-600"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dirty && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateMut.isPending}
                className="bg-indigo-600 hover:bg-indigo-500"
              >
                {updateMut.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Kaydet
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- External Channels Card (PR-NOTIFY) ---

function ExternalChannelsCard() {
  const { toast } = useToast();
  const { data } = useExternalChannelsQuery();
  const addMut = useAddExternalChannelMutation();
  const deleteMut = useDeleteExternalChannelMutation();
  const testMut = useTestExternalChannelMutation();

  const [open, setOpen] = React.useState(false);
  const [channelType, setChannelType] = React.useState<'slack' | 'teams'>('slack');
  const [webhookURL, setWebhookURL] = React.useState('');
  const [channelName, setChannelName] = React.useState('');

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    addMut.mutate(
      { channel_type: channelType, webhook_url: webhookURL, channel_name: channelName },
      {
        onSuccess: () => {
          setOpen(false);
          setWebhookURL('');
          setChannelName('');
          toast({ title: 'Kanal eklendi ve test mesajı gönderildi.' });
        },
        onError: (err) => {
          toast({
            title: 'Kanal eklenemedi',
            description: userFriendlyError(err),
            variant: 'destructive',
          });
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Harici Bildirim Kanalları</CardTitle>
            <CardDescription className="mt-1">
              Slack veya Teams webhook'ları ile bildirimleri harici kanallara yönlendirin.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />
                Kanal Ekle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Webhook Kanalı Ekle</DialogTitle>
                <DialogDescription>
                  Slack veya Teams gelen webhook URL'si girin. Kaydedilmeden önce test mesajı gönderilir.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Kanal Tipi</Label>
                  <div className="flex gap-3">
                    {(['slack', 'teams'] as const).map((t) => (
                      <label key={t} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="channel_type"
                          value={t}
                          checked={channelType === t}
                          onChange={() => setChannelType(t)}
                          className="accent-indigo-600"
                        />
                        <span className="text-sm capitalize">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-name">Kanal Adı</Label>
                  <Input
                    id="channel-name"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="#genel-uyarilar"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    value={webhookURL}
                    onChange={(e) => setWebhookURL(e.target.value)}
                    placeholder="https://hooks.slack.com/..."
                    required
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500"
                    disabled={addMut.isPending}
                  >
                    {addMut.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Test edilip kaydediliyor...
                      </>
                    ) : (
                      'Test Et ve Kaydet'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!data?.channels.length ? (
          <p className="text-sm text-muted-foreground">Henüz kanal eklenmemiş.</p>
        ) : (
          <div className="space-y-2">
            {data.channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <ExternalLink className="h-4 w-4 text-zinc-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{ch.channel_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{ch.channel_type}</p>
                    {ch.last_error && (
                      <p className="flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="h-3 w-3" />
                        {ch.last_error}
                      </p>
                    )}
                    {!ch.last_error && ch.last_used_at && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        Son kullanım: {new Date(ch.last_used_at).toLocaleDateString('tr-TR')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={testMut.isPending}
                    onClick={() =>
                      testMut.mutate(ch.id, {
                        onSuccess: () =>
                          toast({ title: 'Test mesajı gönderildi.' }),
                        onError: (err) =>
                          toast({
                            title: 'Test başarısız',
                            description: userFriendlyError(err),
                            variant: 'destructive',
                          }),
                      })
                    }
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600"
                    onClick={() =>
                      deleteMut.mutate(ch.id, {
                        onSuccess: () => toast({ title: 'Kanal silindi.' }),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Security Keys Card (PR-SEC4) ---

function SecurityKeysCard() {
  const { toast } = useToast();
  const { data, isLoading } = useWebAuthnCredentials();
  const registerBegin = useWebAuthnRegisterBeginMutation();
  const registerFinish = useWebAuthnRegisterFinishMutation();
  const updateCred = useWebAuthnUpdateCredentialMutation();
  const deleteCred = useWebAuthnDeleteCredentialMutation();

  const [addOpen, setAddOpen] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [registering, setRegistering] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editLabel, setEditLabel] = React.useState('');

  const credentials = data ?? [];
  const supported = isWebAuthnSupported();

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || registering) return;
    setRegistering(true);
    try {
      // Step 1: get challenge from server
      const beginRes = await registerBegin.mutateAsync();
      // Step 2: interact with authenticator
      const credentialJSON = await registerSecurityKey(
        beginRes.options as Parameters<typeof registerSecurityKey>[0],
      );
      // Step 3: send response to server
      await registerFinish.mutateAsync({
        session_key: beginRes.session_key,
        label: label.trim(),
        credential: JSON.parse(credentialJSON),
      });
      toast({ title: 'Güvenlik anahtarı eklendi', description: label.trim() });
      setAddOpen(false);
      setLabel('');
    } catch (err) {
      const msg = userFriendlyError(err);
      // User cancelled the authenticator prompt — don't show error
      if (msg.includes('cancelled') || msg.includes('NotAllowed') || msg.includes('abort')) {
        toast({ title: 'İptal edildi', description: 'Güvenlik anahtarı eklenmedi.' });
      } else {
        toast({ title: 'Anahtar eklenemedi', description: msg, variant: 'destructive' });
      }
    } finally {
      setRegistering(false);
    }
  }

  function startEdit(id: string, currentLabel: string) {
    setEditId(id);
    setEditLabel(currentLabel);
  }

  function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || !editLabel.trim()) return;
    updateCred.mutate(
      { id: editId, label: editLabel.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Etiket güncellendi.' });
          setEditId(null);
        },
        onError: (err) =>
          toast({
            title: 'Güncellenemedi',
            description: userFriendlyError(err),
            variant: 'destructive',
          }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <div>
              <CardTitle>Güvenlik Anahtarları</CardTitle>
              <CardDescription className="mt-0.5">
                YubiKey, Touch ID veya diğer FIDO2/WebAuthn kimlik doğrulayıcıları.
              </CardDescription>
            </div>
          </div>
          {supported && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="mr-1 h-4 w-4" />
                  Anahtar Ekle
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Yeni Güvenlik Anahtarı Ekle</DialogTitle>
                  <DialogDescription>
                    Bir etiket girdikten sonra güvenlik anahtarınıza dokunun veya PIN'inizi girin.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddKey} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="key-label">Etiket</Label>
                    <Input
                      id="key-label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="YubiKey 5 NFC"
                      required
                      autoFocus
                      disabled={registering}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500"
                      disabled={!label.trim() || registering}
                    >
                      {registering ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Anahtara dokunun…
                        </>
                      ) : (
                        'Kaydet'
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!supported && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Tarayıcınız WebAuthn'ı desteklemiyor. Güvenlik anahtarı eklemek için modern bir
            tarayıcı kullanın.
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıtlı güvenlik anahtarı yok.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {credentials.map((cred) => (
              <div
                key={cred.id}
                className="flex items-start justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  {editId === cred.id ? (
                    <form onSubmit={handleRename} className="flex items-center gap-2">
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditId(null); }}
                      />
                      <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">
                        Kaydet
                      </Button>
                    </form>
                  ) : (
                    <span className="font-medium">{cred.label}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Eklenme: {new Date(cred.created_at).toLocaleDateString('tr-TR')}
                    {cred.last_used_at && (
                      <> · Son kullanım: {new Date(cred.last_used_at).toLocaleDateString('tr-TR')}</>
                    )}
                  </span>
                  {cred.transports.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Taşıma: {cred.transports.join(', ')}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => startEdit(cred.id, cred.label)}
                    aria-label="Etiketi düzenle"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Anahtarı sil"
                        disabled={deleteCred.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Güvenlik anahtarını sil</AlertDialogTitle>
                        <AlertDialogDescription>
                          <strong>{cred.label}</strong> anahtarı kalıcı olarak kaldırılacak. Bu
                          anahtarla artık giriş yapamayacaksınız.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            deleteCred.mutate(cred.id, {
                              onSuccess: () => toast({ title: 'Güvenlik anahtarı silindi.' }),
                              onError: (err) =>
                                toast({
                                  title: 'Silinemedi',
                                  description: userFriendlyError(err),
                                  variant: 'destructive',
                                }),
                            })
                          }
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Sil
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Profile Page ---

export default function ProfilePage() {
  useDocumentTitle('Profil');
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Profil</h1>
        {user && (
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-mono">{user.username}</span> •{' '}
            {user.roles.join(', ')}
          </p>
        )}
      </div>

      <TOTPManagementCard />
      <SecurityKeysCard />
      <TrustedDevicesCard />
      <NotificationPrefsCard />
      <ExternalChannelsCard />
    </div>
  );
}
