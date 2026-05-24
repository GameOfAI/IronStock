/**
 * Admin Log Yönlendirme — PR-LOG1.
 *
 * Audit log eventlerini Syslog (UDP/TCP) veya Slack webhook'a forward eder.
 * Her config için Manager bir goroutine çalıştırır; channel dolunca event drop edilir.
 */

import * as React from 'react';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Pencil, Radio, Send } from 'lucide-react';
import {
  useLogForwardingConfigsQuery,
  useCreateLogForwardingMutation,
  useUpdateLogForwardingMutation,
  useDeleteLogForwardingMutation,
  useTestLogForwardingMutation,
} from '@/api/admin-log-forwarding';
import type {
  LogForwardingConfig,
  LogForwardingTargetType,
  SyslogConfig,
  SlackConfig,
  SplunkConfig,
  ElasticConfig,
} from '@envanter/shared/api/types';
import { useDocumentTitle } from '@/hooks/use-document-title';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  target_type: LogForwardingTargetType;
  enabled: boolean;
  // syslog
  protocol: 'udp' | 'tcp';
  host: string;
  port: string;
  app_name: string;
  // slack
  webhook_url: string;
  channel: string;
  username: string;
  // splunk
  splunk_url: string;
  splunk_token: string;
  splunk_index: string;
  splunk_source_type: string;
  // elastic
  elastic_url: string;
  elastic_api_key: string;
  elastic_username: string;
  elastic_password: string;
  elastic_index: string;
};

const emptyForm = (): FormState => ({
  name: '',
  target_type: 'syslog',
  enabled: true,
  protocol: 'udp',
  host: '',
  port: '514',
  app_name: 'ironstock',
  webhook_url: '',
  channel: '',
  username: 'IronStock',
  splunk_url: '',
  splunk_token: '',
  splunk_index: '',
  splunk_source_type: 'ironstock:audit',
  elastic_url: '',
  elastic_api_key: '',
  elastic_username: '',
  elastic_password: '',
  elastic_index: 'ironstock-audit',
});

function configToForm(cfg: LogForwardingConfig): FormState {
  const base: FormState = emptyForm();
  base.name = cfg.name;
  base.target_type = cfg.target_type;
  base.enabled = cfg.enabled;
  if (cfg.target_type === 'syslog') {
    const c = cfg.config as SyslogConfig;
    base.protocol = c.protocol ?? 'udp';
    base.host = c.host ?? '';
    base.port = String(c.port ?? 514);
    base.app_name = c.app_name ?? 'ironstock';
  } else if (cfg.target_type === 'slack') {
    const c = cfg.config as SlackConfig;
    base.webhook_url = c.webhook_url ?? '';
    base.channel = c.channel ?? '';
    base.username = c.username ?? 'IronStock';
  } else if (cfg.target_type === 'splunk') {
    const c = cfg.config as SplunkConfig;
    base.splunk_url = c.url ?? '';
    base.splunk_token = c.token ?? '';
    base.splunk_index = c.index ?? '';
    base.splunk_source_type = c.source_type ?? 'ironstock:audit';
  } else if (cfg.target_type === 'elastic') {
    const c = cfg.config as ElasticConfig;
    base.elastic_url = c.url ?? '';
    base.elastic_api_key = c.api_key ?? '';
    base.elastic_username = c.username ?? '';
    base.elastic_password = c.password ?? '';
    base.elastic_index = c.index ?? 'ironstock-audit';
  }
  return base;
}

function formToConfig(form: FormState): SyslogConfig | SlackConfig | SplunkConfig | ElasticConfig {
  if (form.target_type === 'syslog') {
    return {
      protocol: form.protocol,
      host: form.host,
      port: parseInt(form.port) || 514,
      app_name: form.app_name || undefined,
    } satisfies SyslogConfig;
  }
  if (form.target_type === 'splunk') {
    return {
      url: form.splunk_url,
      token: form.splunk_token,
      index: form.splunk_index || undefined,
      source_type: form.splunk_source_type || 'ironstock:audit',
    } satisfies SplunkConfig;
  }
  if (form.target_type === 'elastic') {
    const cfg: ElasticConfig = {
      url: form.elastic_url,
      index: form.elastic_index || 'ironstock-audit',
    };
    if (form.elastic_api_key) cfg.api_key = form.elastic_api_key;
    if (form.elastic_username) {
      cfg.username = form.elastic_username;
      cfg.password = form.elastic_password;
    }
    return cfg;
  }
  return {
    webhook_url: form.webhook_url,
    channel: form.channel || undefined,
    username: form.username || undefined,
  } satisfies SlackConfig;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLogForwardingPage() {
  useDocumentTitle('Log Yönlendirme');
  const { toast } = useToast();
  const { data, isLoading } = useLogForwardingConfigsQuery();
  const deleteMutation = useDeleteLogForwardingMutation();
  const testMutation = useTestLogForwardingMutation();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingConfig, setEditingConfig] = React.useState<LogForwardingConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<LogForwardingConfig | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());

  function openCreate() {
    setEditingConfig(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(cfg: LogForwardingConfig) {
    setEditingConfig(cfg);
    setForm(configToForm(cfg));
    setDialogOpen(true);
  }

  function handleTest(id: string) {
    testMutation.mutate(id, {
      onSuccess: () => toast({ title: 'Test başarılı', description: 'Hedef bağlantı sağlandı.' }),
      onError: (e) =>
        toast({ title: 'Test başarısız', description: String(e), variant: 'destructive' }),
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast({ title: 'Silindi' });
      },
      onError: (e) => toast({ title: 'Hata', description: String(e), variant: 'destructive' }),
    });
  }

  const configs = data?.configs ?? [];

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Log Yönlendirme</h1>
            <p className="text-sm text-slate-400">
              Audit log eventlerini Syslog, Slack, Splunk veya Elasticsearch'e ilet
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Yeni Hedef
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : configs.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="py-16 text-center text-slate-400">
            <Radio className="mx-auto h-10 w-10 mb-3 opacity-30" />
            <p>Henüz log yönlendirme hedefi yok.</p>
            <p className="text-sm mt-1">
              "Yeni Hedef" ile Syslog, Slack, Splunk veya Elastic hedef ekleyin.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map((cfg) => (
            <ConfigCard
              key={cfg.id}
              cfg={cfg}
              onEdit={() => openEdit(cfg)}
              onDelete={() => setDeleteTarget(cfg)}
              onTest={() => handleTest(cfg.id)}
              testing={testMutation.isPending && testMutation.variables === cfg.id}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <ConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingConfig={editingConfig}
        form={form}
        setForm={setForm}
        onSuccess={() => setDialogOpen(false)}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hedefi sil?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> kalıcı olarak silinecek. Devam eden log
              iletimi duracak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Sil'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Config Card ──────────────────────────────────────────────────────────────

interface ConfigCardProps {
  cfg: LogForwardingConfig;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
}

function ConfigCard({ cfg, onEdit, onDelete, onTest, testing }: ConfigCardProps) {
  const updateMutation = useUpdateLogForwardingMutation(cfg.id);
  const { toast } = useToast();

  function toggleEnabled() {
    updateMutation.mutate(
      { enabled: !cfg.enabled },
      {
        onError: (e) => toast({ title: 'Hata', description: String(e), variant: 'destructive' }),
      }
    );
  }

  const configSummary = (() => {
    if (cfg.target_type === 'syslog') {
      const c = cfg.config as SyslogConfig;
      return `${c.protocol?.toUpperCase() ?? 'UDP'} ${c.host}:${c.port ?? 514}`;
    }
    if (cfg.target_type === 'splunk') {
      const c = cfg.config as SplunkConfig;
      const url = c.url ?? '';
      return url.length > 50 ? url.slice(0, 47) + '…' : url;
    }
    if (cfg.target_type === 'elastic') {
      const c = cfg.config as ElasticConfig;
      const url = c.url ?? '';
      return `${url.length > 40 ? url.slice(0, 37) + '…' : url} / ${c.index ?? 'ironstock-audit'}`;
    }
    const c = cfg.config as SlackConfig;
    const url = c.webhook_url ?? '';
    return url.length > 50 ? url.slice(0, 47) + '…' : url;
  })();

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Switch
              checked={cfg.enabled}
              onCheckedChange={toggleEnabled}
              disabled={updateMutation.isPending}
            />
            <div>
              <CardTitle className="text-base font-medium text-slate-100">{cfg.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{configSummary}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={cfg.target_type === 'syslog' ? 'default' : 'secondary'}
              className="text-xs uppercase"
            >
              {cfg.target_type}
            </Badge>
            <Badge variant={cfg.enabled ? 'default' : 'outline'} className="text-xs">
              {cfg.enabled ? 'Aktif' : 'Pasif'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex justify-end gap-2 pt-0">
        <Button variant="outline" size="sm" onClick={onTest} disabled={testing} className="gap-1">
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Test
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} className="gap-1">
          <Pencil className="h-3 w-3" />
          Düzenle
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="gap-1 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
          Sil
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Config Dialog ────────────────────────────────────────────────────────────

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editingConfig: LogForwardingConfig | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSuccess: () => void;
}

function ConfigDialog({
  open,
  onOpenChange,
  editingConfig,
  form,
  setForm,
  onSuccess,
}: ConfigDialogProps) {
  const { toast } = useToast();
  const createMutation = useCreateLogForwardingMutation();
  const updateMutation = useUpdateLogForwardingMutation(editingConfig?.id ?? '');

  const isPending = createMutation.isPending || updateMutation.isPending;

  function set(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit() {
    const config = formToConfig(form);

    if (editingConfig) {
      updateMutation.mutate(
        { name: form.name, enabled: form.enabled, config },
        {
          onSuccess: () => {
            toast({ title: 'Güncellendi' });
            onSuccess();
          },
          onError: (e) => toast({ title: 'Hata', description: String(e), variant: 'destructive' }),
        }
      );
    } else {
      createMutation.mutate(
        { name: form.name, target_type: form.target_type, enabled: form.enabled, config },
        {
          onSuccess: () => {
            toast({ title: 'Oluşturuldu' });
            onSuccess();
          },
          onError: (e) => toast({ title: 'Hata', description: String(e), variant: 'destructive' }),
        }
      );
    }
  }

  const title = editingConfig ? 'Hedefi Düzenle' : 'Yeni Log Hedefi';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="lfname">Ad</Label>
            <Input
              id="lfname"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Prod Syslog"
            />
          </div>

          {/* Target type — locked on edit */}
          {!editingConfig && (
            <div className="space-y-1.5">
              <Label htmlFor="lftype">Hedef Türü</Label>
              <Select
                value={form.target_type}
                onValueChange={(v) => set({ target_type: v as LogForwardingTargetType })}
              >
                <SelectTrigger id="lftype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="syslog">Syslog (UDP/TCP)</SelectItem>
                  <SelectItem value="slack">Slack Webhook</SelectItem>
                  <SelectItem value="splunk">Splunk HEC</SelectItem>
                  <SelectItem value="elastic">Elasticsearch / Elastic Cloud</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Syslog fields */}
          {form.target_type === 'syslog' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lfprotocol">Protokol</Label>
                  <Select
                    value={form.protocol}
                    onValueChange={(v) => set({ protocol: v as 'udp' | 'tcp' })}
                  >
                    <SelectTrigger id="lfprotocol">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="lfhost">Host</Label>
                  <Input
                    id="lfhost"
                    value={form.host}
                    onChange={(e) => set({ host: e.target.value })}
                    placeholder="syslog.example.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lfport">Port</Label>
                  <Input
                    id="lfport"
                    value={form.port}
                    onChange={(e) => set({ port: e.target.value })}
                    placeholder="514"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lfappname">App Name</Label>
                  <Input
                    id="lfappname"
                    value={form.app_name}
                    onChange={(e) => set({ app_name: e.target.value })}
                    placeholder="ironstock"
                  />
                </div>
              </div>
            </>
          )}

          {/* Slack fields */}
          {form.target_type === 'slack' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lfwebhook">Webhook URL</Label>
                <Input
                  id="lfwebhook"
                  value={form.webhook_url}
                  onChange={(e) => set({ webhook_url: e.target.value })}
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lfchannel">Kanal (opsiyonel)</Label>
                  <Input
                    id="lfchannel"
                    value={form.channel}
                    onChange={(e) => set({ channel: e.target.value })}
                    placeholder="#security-alerts"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lfusername">Bot Adı (opsiyonel)</Label>
                  <Input
                    id="lfusername"
                    value={form.username}
                    onChange={(e) => set({ username: e.target.value })}
                    placeholder="IronStock"
                  />
                </div>
              </div>
            </>
          )}

          {/* Splunk fields */}
          {form.target_type === 'splunk' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="splunk_url">HEC Endpoint URL</Label>
                <Input
                  id="splunk_url"
                  value={form.splunk_url}
                  onChange={(e) => set({ splunk_url: e.target.value })}
                  placeholder="https://splunk.example.com:8088/services/collector/event"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="splunk_token">HEC Token</Label>
                <Input
                  id="splunk_token"
                  type="password"
                  value={form.splunk_token}
                  onChange={(e) => set({ splunk_token: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="splunk_index">Index (opsiyonel)</Label>
                  <Input
                    id="splunk_index"
                    value={form.splunk_index}
                    onChange={(e) => set({ splunk_index: e.target.value })}
                    placeholder="main"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="splunk_source_type">Source Type</Label>
                  <Input
                    id="splunk_source_type"
                    value={form.splunk_source_type}
                    onChange={(e) => set({ splunk_source_type: e.target.value })}
                    placeholder="ironstock:audit"
                  />
                </div>
              </div>
            </>
          )}

          {/* Elastic fields */}
          {form.target_type === 'elastic' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="elastic_url">Elasticsearch URL</Label>
                <Input
                  id="elastic_url"
                  value={form.elastic_url}
                  onChange={(e) => set({ elastic_url: e.target.value })}
                  placeholder="https://elastic.example.com:9200"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="elastic_index">Index Adı</Label>
                <Input
                  id="elastic_index"
                  value={form.elastic_index}
                  onChange={(e) => set({ elastic_index: e.target.value })}
                  placeholder="ironstock-audit"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="elastic_api_key">API Key (veya kullanıcı adı/şifre)</Label>
                <Input
                  id="elastic_api_key"
                  type="password"
                  value={form.elastic_api_key}
                  onChange={(e) => set({ elastic_api_key: e.target.value })}
                  placeholder="id:api_key (base64)"
                />
              </div>
              {!form.elastic_api_key && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="elastic_username">Kullanıcı Adı</Label>
                    <Input
                      id="elastic_username"
                      value={form.elastic_username}
                      onChange={(e) => set({ elastic_username: e.target.value })}
                      placeholder="elastic"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="elastic_password">Şifre</Label>
                    <Input
                      id="elastic_password"
                      type="password"
                      value={form.elastic_password}
                      onChange={(e) => set({ elastic_password: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Enabled toggle */}
          <div className="flex items-center gap-3 pt-1">
            <Switch
              id="lfenabled"
              checked={form.enabled}
              onCheckedChange={(v: boolean) => set({ enabled: v })}
            />
            <Label htmlFor="lfenabled" className="cursor-pointer">
              Aktif (kayıt sonrası hemen başlar)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            İptal
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} className="gap-2">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingConfig ? 'Güncelle' : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
