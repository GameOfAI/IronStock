/**
 * FieldVersionsDialog — shows the last 10 encrypted snapshots of a field (PR-N2).
 *
 * Values stay encrypted (opaque blobs). The dialog shows version timestamps
 * so operators can track when credentials were rotated.
 */

import * as React from 'react';
import { History, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFieldVersionsQuery } from '@/api/items';
import { RelativeTime } from '@/components/common/relative-time';

interface Props {
  itemId: string;
  fieldDefId: number;
  fieldLabel: string;
}

export function FieldVersionsDialog({ itemId, fieldDefId, fieldLabel }: Props) {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading, isError } = useFieldVersionsQuery(
    open ? itemId : null,
    open ? fieldDefId : null,
  );

  const versions = data?.versions ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${fieldLabel} geçmişini gör`}
          title="Değer geçmişi"
          className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-opacity"
        >
          <History size={13} />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {fieldLabel} — Değer Geçmişi
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-red-600">Geçmiş alınamadı.</p>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <History className="h-8 w-8 opacity-40" />
            <p className="text-sm">Bu alan henüz güncellenmedi.</p>
            <p className="text-xs">İlk güncellemeden sonra geçmiş burada görünür.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Son {versions.length} değişiklik gösteriliyor. Değerler şifreli tutulur.
            </p>
            <div className="divide-y rounded-md border">
              {versions.map((v) => (
                <div key={v.version_number} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-mono font-medium">
                    {v.version_number}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3 shrink-0" />
                      <span>Şifreli değer</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <RelativeTime iso={v.changed_at} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Kapat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
