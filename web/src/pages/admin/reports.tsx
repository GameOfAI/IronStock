/**
 * AdminReportsPage — HTML inventory report generation (PR-K8S).
 *
 * Admins select items, choose options, and download a self-contained HTML report
 * that optionally includes live K8s data (pods, deployments, metrics, events).
 */

import { useState, useDeferredValue } from 'react';
import {
  FileText, Loader2, Search, X, Check, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/api/client';
import { useGenerateReportMutation } from '@/api/reports';
import type { ItemListResponse, Item } from '@/api/types';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

// ─── Item search ──────────────────────────────────────────────────────────────

function useItemSearch(q: string) {
  const dq = useDeferredValue(q);
  return useQuery({
    queryKey: ['admin-report-item-search', dq],
    queryFn: () => apiFetch<ItemListResponse>('/api/v1/items/search', { query: { q: dq } }),
    enabled: dq.length >= 2,
    staleTime: 30_000,
    select: (data) => data.items ?? [],
  });
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  selected,
  onToggle,
}: {
  item: Item;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors',
        selected
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
          : 'hover:bg-muted/50',
      )}
    >
      <div className={cn(
        'h-4 w-4 shrink-0 rounded border flex items-center justify-center',
        selected ? 'bg-primary border-primary' : 'border-input',
      )}>
        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <span className="flex-1 font-medium truncate">{item.name}</span>
      {item.item_type_id && (
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
          {item.item_type_id}
        </span>
      )}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  include_k8s_live: true,
  include_relationships: true,
  include_field_values: false,
  report_title: '',
};

export default function AdminReportsPage() {
  useDocumentTitle('Raporlar');
  const { toast } = useToast();
  const generate = useGenerateReportMutation();

  const [searchQuery, setSearchQuery] = useState('');
  const { data: searchResults, isLoading: searching } = useItemSearch(searchQuery);

  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [optionsOpen, setOptionsOpen] = useState(true);

  const selectedIds = new Set(selectedItems.map((i) => i.id));

  const toggleItem = (item: Item) => {
    setSelectedItems((prev) => {
      if (selectedIds.has(item.id)) {
        return prev.filter((i) => i.id !== item.id);
      }
      if (prev.length >= 50) {
        toast({ title: 'Uyarı', description: 'En fazla 50 item seçebilirsiniz.', variant: 'destructive' });
        return prev;
      }
      return [...prev, item];
    });
  };

  const removeSelected = (id: string) =>
    setSelectedItems((prev) => prev.filter((i) => i.id !== id));

  const setOpt = <K extends keyof typeof options>(k: K, v: (typeof options)[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));

  const handleGenerate = () => {
    if (selectedItems.length === 0) {
      toast({ title: 'Hata', description: 'En az bir item seçin.', variant: 'destructive' });
      return;
    }
    generate.mutate(
      {
        item_ids: selectedItems.map((i) => i.id),
        options: {
          ...options,
          report_title: options.report_title.trim() || 'IronStock Envanter Raporu',
        },
      },
      {
        onSuccess: () => toast({ title: '✅ Rapor indirildi' }),
        onError: (e) => toast({ title: 'Hata', description: userFriendlyError(e), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" /> Raporlar
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seçili item'lar için K8s canlı verisi dahil HTML rapor üretin ve indirin.
        </p>
      </div>

      {/* ── Step 1: Item selection ── */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <div className="font-medium text-sm">1. Item Seç</div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Item ara (min. 2 karakter)…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search results */}
        {searchResults && searchResults.length > 0 && (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-md border p-1">
            {searchResults.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onToggle={() => toggleItem(item)}
              />
            ))}
          </div>
        )}
        {searchQuery.length >= 2 && !searching && searchResults?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">Sonuç bulunamadı.</p>
        )}

        {/* Selected items */}
        {selectedItems.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Seçili ({selectedItems.length}/50)
            </div>
            {selectedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md text-sm"
              >
                <span className="flex-1 truncate font-medium">{item.name}</span>
                {item.item_type_id && (
                  <span className="text-xs text-muted-foreground">{item.item_type_id}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeSelected(item.id)}
                  className="text-muted-foreground hover:text-foreground ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Step 2: Options ── */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <button
          type="button"
          className="flex items-center gap-2 w-full font-medium text-sm"
          onClick={() => setOptionsOpen((o) => !o)}
        >
          2. Seçenekler
          {optionsOpen
            ? <ChevronUp className="h-4 w-4 ml-auto text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />}
        </button>

        {optionsOpen && (
          <div className="flex flex-col gap-3 pt-1">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-title" className="text-sm font-normal">
                Rapor Başlığı
              </Label>
              <Input
                id="report-title"
                placeholder="IronStock Envanter Raporu"
                value={options.report_title}
                onChange={(e) => setOpt('report_title', e.target.value)}
              />
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="opt-k8s" className="text-sm font-normal cursor-pointer">
                    Canlı K8s verisi dahil et
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pod listesi, deployment durumu, CPU/bellek ve uyarı event'leri.
                  </p>
                </div>
                <Switch
                  id="opt-k8s"
                  checked={options.include_k8s_live}
                  onCheckedChange={(v: boolean) => setOpt('include_k8s_live', v)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="opt-rel" className="text-sm font-normal cursor-pointer">
                    İlişkili item'ları dahil et
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Her item'ın tek-hop ilişki grafiğini gösterir.
                  </p>
                </div>
                <Switch
                  id="opt-rel"
                  checked={options.include_relationships}
                  onCheckedChange={(v: boolean) => setOpt('include_relationships', v)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="opt-fields" className="text-sm font-normal cursor-pointer">
                    Alan değerlerini dahil et
                    <span className="ml-1.5 text-xs text-muted-foreground">(sır olmayanlar)</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    is_secret=false alanların değer sayısını gösterir.
                  </p>
                </div>
                <Switch
                  id="opt-fields"
                  checked={options.include_field_values}
                  onCheckedChange={(v: boolean) => setOpt('include_field_values', v)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Generate button ── */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {selectedItems.length > 0
            ? `${selectedItems.length} item seçildi`
            : 'Henüz item seçilmedi'}
        </span>
        <Button
          onClick={handleGenerate}
          disabled={generate.isPending || selectedItems.length === 0}
        >
          {generate.isPending
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <FileText className="mr-2 h-4 w-4" />}
          Rapor Oluştur &amp; İndir
        </Button>
      </div>
    </div>
  );
}
