/**
 * ItemList — orta panel, seçili klasördeki item'lar.
 *
 * Server `?folder_id=X[&q=]` zorunlu folder_id; pagination yok (folder
 * scope'unda makul N). Search HMAC blind-index → exact match.
 */

import { Inbox, Loader2, PackageSearch } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
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
              <TableCell className="font-medium">{item.name}</TableCell>
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
