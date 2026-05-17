/**
 * ItemTagPicker — interactive tag picker for item detail panel (PR-UX2).
 *
 * Shows assigned tags as removable badges + a "+" button that opens a popover
 * with the user's tag list (already assigned ones excluded). Clicking a tag
 * assigns it to the item instantly (optimistic via React Query invalidation).
 */

import * as React from 'react';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  useTagsQuery,
  useItemTagsQuery,
  useAddItemTagMutation,
  useRemoveItemTagMutation,
} from '@/api/tags';
import type { Tag } from '@/api/types';

interface ItemTagPickerProps {
  itemId: string;
}

export function ItemTagPicker({ itemId }: ItemTagPickerProps) {
  const { data: allTagsData } = useTagsQuery();
  const { data: itemTagsData } = useItemTagsQuery(itemId);
  const addTag = useAddItemTagMutation(itemId);
  const removeTag = useRemoveItemTagMutation(itemId);

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const assignedTags: Tag[] = itemTagsData?.tags ?? [];
  const allTags: Tag[] = allTagsData?.tags ?? [];

  // Tags not yet assigned to this item
  const assignedIds = new Set(assignedTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedIds.has(t.id));

  // Filter available by search text
  const filtered = availableTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  function handleAdd(tagId: string) {
    addTag.mutate({ tag_id: tagId });
    setSearch('');
    setOpen(false);
  }

  function handleRemove(tagId: string) {
    removeTag.mutate(tagId);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <TagIcon className="h-3 w-3 text-muted-foreground" />

      {assignedTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="gap-1 px-1.5 py-0 text-[10px] group/tag"
          style={
            tag.color
              ? { backgroundColor: `${tag.color}22`, color: tag.color }
              : undefined
          }
        >
          {tag.name}
          <button
            type="button"
            className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full opacity-50 hover:opacity-100 hover:bg-foreground/10 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(tag.id);
            }}
            title={`"${tag.name}" etiketini kaldır`}
          >
            <X className="h-2 w-2" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            title="Etiket ekle"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <Input
            placeholder="Etiket ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs mb-2"
            autoFocus
          />
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {availableTags.length === 0
                  ? 'Tüm etiketler atanmış'
                  : 'Sonuç yok'}
              </p>
            ) : (
              filtered.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                  onClick={() => handleAdd(tag.id)}
                >
                  {tag.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  <span className="truncate">{tag.name}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
