/**
 * Tags Management Page — PR-N7.
 *
 * Users can create personal tags (name + optional hex color) and delete them.
 * Deleting a tag cascade-removes all item_tags associations.
 *
 * UX: 64-color palette grid + hex input for manual entry. Tag rows use
 * borderLeft style to avoid flex height alignment issues.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Plus, Tag, Trash2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { useTagsQuery, useCreateTagMutation, useDeleteTagMutation } from '@/api/tags';
import { useDocumentTitle } from '@/hooks/use-document-title';

// ─── 64-color palette (8 hue families × 8 lightness steps) ──────────────────

const PALETTE: string[] = [
  // Red
  '#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d','#450a0a',
  // Orange
  '#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12','#431407',
  // Amber / Yellow
  '#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e','#451a03',
  // Lime / Green
  '#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#14532d','#052e16',
  // Teal / Cyan
  '#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#083344',
  // Blue
  '#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#172554',
  // Violet / Purple
  '#e9d5ff','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#2e1065',
  // Pink / Rose
  '#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#500724',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHex(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const preview = isValidHex(value) ? value : '#334155';

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger row: color preview swatch + hex input + chevron */}
      <div className="flex items-center gap-1.5">
        {/* Swatch button */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 transition hover:border-slate-500"
          style={{ backgroundColor: preview }}
          aria-label="Renk seç"
          title="Renk paletini aç"
        >
          <ChevronDown className="h-3 w-3 text-white/70 drop-shadow" />
        </button>

        {/* Hex input */}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#3b82f6"
          maxLength={7}
          spellCheck={false}
          className="w-28 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
        />
      </div>

      {/* Dropdown palette */}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-[220px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl shadow-black/50">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Renk Paleti
          </p>
          <div className="grid grid-cols-8 gap-1">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => { onChange(hex); setOpen(false); }}
                className="h-5 w-5 rounded-sm transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-white/50"
                style={{ backgroundColor: hex }}
                title={hex}
                aria-label={hex}
              />
            ))}
          </div>
          {/* Quick clear */}
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className="mt-3 w-full rounded-md border border-slate-700 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            Renksiz
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TagsPage() {
  useDocumentTitle('Etiketlerim');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading } = useTagsQuery();
  const createMut = useCreateTagMutation();
  const deleteMut = useDeleteTagMutation();

  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('');

  const tags = data?.tags ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const colorVal = isValidHex(color) ? color : undefined;
    try {
      await createMut.mutateAsync({ name: trimmedName, color: colorVal });
      setName('');
      setColor('');
      toast({ title: 'Etiket oluşturuldu', description: trimmedName });
    } catch (err) {
      toast({
        title: 'Etiket oluşturulamadı',
        description: err instanceof Error ? err.message : 'Hata.',
        variant: 'destructive',
      });
    }
  }

  async function handleDelete(tagId: string, tagName: string) {
    try {
      await deleteMut.mutateAsync(tagId);
      toast({ title: 'Etiket silindi', description: tagName });
    } catch {
      toast({ title: 'Etiket silinemedi', variant: 'destructive' });
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-xl px-8 py-7 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Etiketlerim</h1>
          <p className="mt-1 text-[13px] text-slate-400">
            Kişisel etiketler — item'lara atayabilirsiniz.
          </p>
        </div>

        {/* Create form */}
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4"
        >
          <h2 className="text-[13px] font-semibold text-slate-200">Yeni Etiket</h2>

          <div className="flex items-end gap-3">
            {/* Name */}
            <div className="flex-1 space-y-1.5">
              <label
                htmlFor="tag-name"
                className="block font-mono text-[10px] uppercase tracking-wider text-slate-500"
              >
                Ad *
              </label>
              <input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="örn. Kritik, Servis, Dev"
                maxLength={64}
                className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
            </div>

            {/* Color picker */}
            <div className="space-y-1.5">
              <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Renk
              </label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!name.trim() || createMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {createMut.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
            </button>
          </div>
        </form>

        {/* Tag list */}
        {isLoading ? (
          <p className="text-sm text-slate-500">Yükleniyor…</p>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-slate-500">
            <Tag className="h-8 w-8 opacity-40" />
            <p className="text-sm">Henüz etiket yok. Yukarıdan oluşturun.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map((tag) => {
              const col = tag.color && isValidHex(tag.color) ? tag.color : '#64748b';
              const rgb = hexToRgb(col);
              const gradient = rgb
                ? `linear-gradient(90deg, rgba(${rgb.r},${rgb.g},${rgb.b},0.16) 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0.03) 100%)`
                : 'none';

              return (
                <div
                  key={tag.id}
                  className="group flex items-center rounded-lg border border-slate-800 overflow-hidden"
                  style={{
                    background: gradient,
                    borderLeft: `3px solid ${col}`,
                  }}
                >
                  {/* Clickable name area */}
                  <div
                    className="flex flex-1 cursor-pointer items-center gap-3 px-4 py-2.5"
                    onClick={() => navigate(`/inventory?tag=${tag.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventory?tag=${tag.id}`)}
                    title="Bu etiketle filtrelenmiş envantere git"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: col }}
                    />
                    <span
                      className="font-mono text-[13px] font-medium"
                      style={{ color: col }}
                    >
                      {tag.name}
                    </span>
                  </div>

                  {/* Delete button */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        className="mr-2 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-red-400 group-hover:opacity-100"
                        aria-label={`${tag.name} etiketini sil`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-800 bg-slate-900">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-slate-100">Etiketi sil</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          <strong className="text-slate-200">{tag.name}</strong> etiketi tüm
                          item'lardan kaldırılacak. Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 text-white hover:bg-red-500"
                          onClick={() => handleDelete(tag.id, tag.name)}
                        >
                          Sil
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
            <p className="pt-1 text-[11px] text-slate-600">
              {tags.length} etiket · Silme geri alınamaz.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
