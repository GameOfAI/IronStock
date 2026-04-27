/**
 * ItemFieldRow — bir item'ın tek field'ını gösterir.
 *
 * PR-W4 read-only: server itemResponse'unda `owner_dek_wrapped` yok →
 * client decrypt edemiyor. Field metadata (label, key, is_secret)
 * field-definitions catalog'undan alınır; value yerine "🔒 Şifreli"
 * placeholder + "PR-W5'te düzenleme modunda görüntülenecek" hint'i.
 */

import { Lock } from 'lucide-react';
import type { FieldDefinition, ItemFieldOutput } from '@/api/types';
import { cn } from '@/lib/cn';

interface ItemFieldRowProps {
  field: ItemFieldOutput;
  definition: FieldDefinition | undefined;
}

export function ItemFieldRow({ field, definition }: ItemFieldRowProps) {
  const label = definition?.label ?? `field:${field.field_definition_id}`;
  const key = definition?.key;
  const fieldType = definition?.field_type;
  const isSecret = definition?.is_secret ?? false;

  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 border-b py-2 last:border-b-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {key ? (
          <div className="font-mono text-[10px] uppercase text-muted-foreground">
            {key}
            {fieldType ? <span className="ml-1">· {fieldType}</span> : null}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          'flex items-center gap-2 text-sm',
          isSecret ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-mono text-xs">Şifreli</span>
      </div>
    </div>
  );
}
