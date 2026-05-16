/**
 * Tags Management Page — PR-N7.
 *
 * Users can create personal tags (name + optional hex color) and delete them.
 * Deleting a tag cascade-removes all item_tags associations.
 */

import * as React from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { useTagsQuery, useCreateTagMutation, useDeleteTagMutation } from '@/api/tags';

function HexColorPreview({ color }: { color: string }) {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(color);
  if (!isValid) return null;
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-sm border"
      style={{ backgroundColor: color }}
    />
  );
}

export default function TagsPage() {
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
    const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
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
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Etiketlerim</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kişisel etiketler — item'lara atayabilirsiniz.
        </p>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-sm font-medium">Yeni Etiket</h2>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="tag-name">Ad *</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. Kritik, Servis, Dev"
              maxLength={64}
            />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="tag-color">Renk (opsiyonel)</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="tag-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#3b82f6"
                maxLength={7}
                className="flex-1"
              />
              <HexColorPreview color={color} />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="gap-2" disabled={!name.trim() || createMut.isPending}>
            <Plus className="h-4 w-4" />
            {createMut.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
          </Button>
        </div>
      </form>

      {/* Tag list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
          <Tag className="h-8 w-8 opacity-40" />
          <p className="text-sm">Henüz etiket yok. Yukarıdan oluşturun.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 px-4 py-2.5">
              {tag.color && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              <Badge
                variant="secondary"
                className="flex-1 justify-start font-normal"
                style={tag.color ? { backgroundColor: `${tag.color}22`, color: tag.color } : undefined}
              >
                {tag.name}
              </Badge>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Etiketi sil</AlertDialogTitle>
                    <AlertDialogDescription>
                      <strong>{tag.name}</strong> etiketi tüm item'lardan kaldırılacak.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>İptal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => handleDelete(tag.id, tag.name)}
                    >
                      Sil
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
