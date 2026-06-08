import * as React from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useItemAnnotationsQuery,
  useUpsertAnnotationMutation,
  useDeleteAnnotationMutation,
} from '@/api/annotations';
import type { Item } from '@/api/types';

interface AnnotationsPanelProps {
  entity: Item;
}

export function AnnotationsPanel({ entity }: AnnotationsPanelProps) {
  const canWrite = entity.permission === 'write';
  const { data, isLoading } = useItemAnnotationsQuery(entity.id);
  const upsert = useUpsertAnnotationMutation(entity.id);
  const remove = useDeleteAnnotationMutation(entity.id);

  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [addMode, setAddMode] = React.useState(false);
  const [newKey, setNewKey] = React.useState('');
  const [newValue, setNewValue] = React.useState('');

  const annotations = data?.annotations ?? [];

  function handleStartEdit(key: string, value: string) {
    setEditingKey(key);
    setEditValue(value);
  }

  function handleSaveEdit(key: string) {
    upsert.mutate(
      { key, value: editValue },
      { onSuccess: () => setEditingKey(null) },
    );
  }

  function handleAdd() {
    if (!newKey.trim()) return;
    upsert.mutate(
      { key: newKey.trim(), value: newValue },
      {
        onSuccess: () => {
          setAddMode(false);
          setNewKey('');
          setNewValue('');
        },
      },
    );
  }

  function handleDelete(key: string) {
    remove.mutate(key);
  }

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Yükleniyor...</div>
    );
  }

  return (
    <div className="space-y-3 p-1">
      {annotations.length === 0 && !addMode && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Henüz annotation eklenmemiş.
        </p>
      )}

      {annotations.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Anahtar</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Değer</th>
                {canWrite && (
                  <th className="px-3 py-2 w-20 text-right font-medium text-muted-foreground">İşlem</th>
                )}
              </tr>
            </thead>
            <tbody>
              {annotations.map((ann) => (
                <tr key={ann.key} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {ann.key}
                  </td>
                  <td className="px-3 py-2">
                    {editingKey === ann.key ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-7 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(ann.key);
                            if (e.key === 'Escape') setEditingKey(null);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => handleSaveEdit(ann.key)}
                          disabled={upsert.isPending}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setEditingKey(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm">{ann.value}</span>
                    )}
                  </td>
                  {canWrite && editingKey !== ann.key && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleStartEdit(ann.key, ann.value)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDelete(ann.key)}
                          disabled={remove.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addMode && (
        <div className="flex items-end gap-2 rounded-md border p-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Anahtar</label>
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="ör. grafana/dashboard-url"
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Değer</label>
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Değer"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') setAddMode(false);
              }}
            />
          </div>
          <Button size="sm" className="h-8" onClick={handleAdd} disabled={upsert.isPending || !newKey.trim()}>
            Ekle
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setAddMode(false)}>
            İptal
          </Button>
        </div>
      )}

      {canWrite && !addMode && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setAddMode(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Annotation Ekle
        </Button>
      )}
    </div>
  );
}
