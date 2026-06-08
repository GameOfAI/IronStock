import * as React from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  usePortalTemplatesQuery,
  useCreatePortalTemplateMutation,
  useUpdatePortalTemplateMutation,
  useDeletePortalTemplateMutation,
} from '@/api/portal-templates';
import type { PortalTemplate } from '@/api/types';

const KINDS = ['Server', 'Service', 'Database', 'SSHKey', 'Certificate', 'CloudCredential', 'Note', 'Credential'];

interface TemplateFormData {
  name: string;
  description: string;
  kind_key: string;
  default_annotations: string;
  default_lifecycle_stages: string;
  is_active: boolean;
}

const emptyForm: TemplateFormData = {
  name: '',
  description: '',
  kind_key: 'Server',
  default_annotations: '',
  default_lifecycle_stages: '',
  is_active: true,
};

function formFromTemplate(t: PortalTemplate): TemplateFormData {
  return {
    name: t.name,
    description: t.description ?? '',
    kind_key: t.kind_key,
    default_annotations: t.default_annotations
      ? Object.entries(t.default_annotations).map(([k, v]) => `${k}=${v}`).join('\n')
      : '',
    default_lifecycle_stages: t.default_lifecycle_stages?.join(', ') ?? '',
    is_active: t.is_active,
  };
}

export default function AdminPortalTemplatesPage() {
  const { data, isLoading } = usePortalTemplatesQuery(undefined, true);
  const createMut = useCreatePortalTemplateMutation();
  const updateMut = useUpdatePortalTemplateMutation();
  const deleteMut = useDeletePortalTemplateMutation();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<TemplateFormData>(emptyForm);

  const templates = data?.templates ?? [];

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(t: PortalTemplate) {
    setEditId(t.id);
    setForm(formFromTemplate(t));
    setDialogOpen(true);
  }

  function parseAnnotations(raw: string): Record<string, string> | null {
    if (!raw.trim()) return null;
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function parseStages(raw: string): string[] | null {
    if (!raw.trim()) return null;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function handleSubmit() {
    const body = {
      name: form.name,
      description: form.description || undefined,
      kind_key: form.kind_key,
      default_annotations: parseAnnotations(form.default_annotations),
      default_lifecycle_stages: parseStages(form.default_lifecycle_stages),
    };

    if (editId) {
      updateMut.mutate(
        { id: editId, ...body },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createMut.mutate(body, { onSuccess: () => setDialogOpen(false) });
    }
  }

  function handleDelete(id: string) {
    deleteMut.mutate(id);
  }

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Portal Şablonları</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Golden Path template'lerini yönetin
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Yeni Şablon
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Henüz portal şablonu yok.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id} className={!t.is_active ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <Badge variant="outline" className="text-xs font-mono">
                      {t.kind_key}
                    </Badge>
                    {t.is_builtin && (
                      <Badge variant="secondary" className="text-[10px]">
                        Yerleşik
                      </Badge>
                    )}
                    {!t.is_active && (
                      <Badge variant="destructive" className="text-[10px]">
                        Pasif
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(t)}
                      title="Düzenle"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!t.is_builtin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(t.id)}
                        disabled={deleteMut.isPending}
                        title="Sil"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {t.description && (
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  {t.default_annotations && Object.keys(t.default_annotations).length > 0 && (
                    <span>{Object.keys(t.default_annotations).length} annotation</span>
                  )}
                  {t.default_lifecycle_stages && t.default_lifecycle_stages.length > 0 && (
                    <span>{t.default_lifecycle_stages.length} lifecycle stage</span>
                  )}
                  <span>
                    {new Date(t.created_at).toLocaleDateString('tr-TR')}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editId ? 'Şablonu Düzenle' : 'Yeni Şablon'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Ad</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ör. Standart Sunucu"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Açıklama</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Şablonun amacı..."
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Kind</label>
              <Select
                value={form.kind_key}
                onValueChange={(v) => setForm((f) => ({ ...f, kind_key: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Varsayılan Annotation'lar</label>
              <Textarea
                value={form.default_annotations}
                onChange={(e) => setForm((f) => ({ ...f, default_annotations: e.target.value }))}
                placeholder={"grafana/dashboard-url=https://...\ngithub.com/project-slug=org/repo"}
                rows={3}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Satır başı: anahtar=değer</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Varsayılan Lifecycle Stage'ler</label>
              <Input
                value={form.default_lifecycle_stages}
                onChange={(e) => setForm((f) => ({ ...f, default_lifecycle_stages: e.target.value }))}
                placeholder="development, testing, production"
              />
              <p className="text-[11px] text-muted-foreground">Virgülle ayırın</p>
            </div>
            {editId && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className="flex items-center gap-2 text-sm"
                >
                  {form.is_active ? (
                    <ToggleRight className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                  )}
                  {form.is_active ? 'Aktif' : 'Pasif'}
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              İptal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name.trim() || createMut.isPending || updateMut.isPending}
            >
              {editId ? 'Güncelle' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
