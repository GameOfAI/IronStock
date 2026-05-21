/**
 * Pagination — controlled pagination kontrol elemanı.
 * Ported from web/src/components/common/pagination.tsx.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onPageChange(nextOffset: number): void;
  onLimitChange(nextLimit: number): void;
  pageSizes?: number[];
}

const DEFAULT_PAGE_SIZES = [25, 50, 100];

export function Pagination({
  offset,
  limit,
  total,
  onPageChange,
  onLimitChange,
  pageSizes = DEFAULT_PAGE_SIZES,
}: PaginationProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <div className="text-muted-foreground">
        Toplam <span className="font-medium text-foreground">{total}</span> kayıt
      </div>
      <div className="flex items-center gap-3">
        <Select value={String(limit)} onValueChange={(v) => onLimitChange(Number(v))}>
          <SelectTrigger className="h-8 w-[110px]" aria-label="Sayfa boyutu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizes.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s} / sayfa
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!canPrev}
            aria-label="Önceki sayfa"
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[64px] text-center tabular-nums" aria-live="polite">
            {currentPage} / {totalPages}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!canNext}
            aria-label="Sonraki sayfa"
            onClick={() => onPageChange(offset + limit)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
