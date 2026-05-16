/**
 * ItemList — orta panel, seçili klasördeki item'lar.
 *
 * Server `?folder_id=X[&q=]` zorunlu folder_id; pagination yok (folder
 * scope'unda makul N). Search HMAC blind-index → exact match.
 */

import { AlertTriangle, Clock, Inbox, Loader2, PackageSearch } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { Item, ItemType } from '@/api/types';
import { PermissionBadge } from './permission-badge';
import { RelativeTime } from '@/components/common/relative-time';

interface ItemListProps {
  items: Item[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Klasör seçilmediyse list pasif. */
  folderSelected: boolean;
  /** Search query — empty result mesajı için. */
  searchQuery: string;
  selectedItemId: string | null;
  onSelect(id: string): void;
  itemTypes: ItemType[];
}

function itemTypeLabel(types: ItemType[], typeId: number): string {
  return types.find((t) => t.id === typeId)?.label ?? `tip:${typeId}`;
}

// --- Expiry badge (PR-N1) ---

type ExpiryStatus = 'expired' | 'warning' | null;

function getExpiryStatus(expiresAt?: string | null): ExpiryStatus {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  if (exp <= now) return 'expired';
  if (exp <= now + 7 * 24 * 60 * 60 * 1000) return 'warning';
  return null;
}

function ExpiryBadge({ expiresAt }: { expiresAt?: string | null }) {
  const status = getExpiryStatus(expiresAt);
  if (!status) return null;

  const isExpired = status === 'expired';
  const label = isExpired
    ? `Süresi doldu: ${new Date(expiresAt!).toLocaleDateString('tr-TR')}`
    : `Süresi yaklaşıyor: ${new Date(expiresAt!).toLocaleDateString('tr-TR')}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('ml-1.5 inline-flex items-center', isExpired ? 'text-destructive' : 'text-amber-500')}>
          {isExpired
            ? <AlertTriangle className="h-3.5 w-3.5" aria-label={label} />
            : <Clock className="h-3.5 w-3.5" aria-label={label} />
          }
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
    </TableRow>
  );
}

export function ItemList({
  items,
  isLoading,
  isError,
  folderSelected,
  searchQuery,
  selectedItemId,
  onSelect,
  itemTypes,
}: ItemListProps) {
  if (!folderSelected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <PackageSearch className="h-8 w-8" aria-hidden />
        <p className="text-sm">Soldan bir klasör seçin.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Item listesi alınamadı.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>İsim</TableHead>
          <TableHead>Tip</TableHead>
          <TableHead className="w-[80px]">İzin</TableHead>
          <TableHead className="w-[120px]">Güncellendi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && !items ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)
        ) : items && items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Inbox className="h-6 w-6" aria-hidden />
                )}
                <span>
                  {searchQuery
                    ? `"${searchQuery}" araması ile eşleşen item yok.`
                    : 'Bu klasörde item yok.'}
                </span>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          items?.map((item) => (
            <TableRow
              key={item.id}
              data-state={selectedItemId === item.id ? 'selected' : undefined}
              className={cn(
                'cursor-pointer',
                selectedItemId === item.id && 'bg-accent',
              )}
              onClick={() => onSelect(item.id)}
            >
              <TableCell className="font-medium">
                <span className="inline-flex items-center">
                  {item.name}
                  <ExpiryBadge expiresAt={item.expires_at} />
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {itemTypeLabel(itemTypes, item.item_type_id)}
              </TableCell>
              <TableCell>
                <PermissionBadge permission={item.permission} compact />
              </TableCell>
              <TableCell>
                <RelativeTime iso={item.updated_at} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
