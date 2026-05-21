/**
 * AuditFilters — audit log için filter UI.
 * Ported from web/src/components/admin/audit-filters.tsx.
 */

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ALL_AUDIT_ACTIONS } from './action-icon';
import type { AdminUser } from '@/api/types';

const ALL_VALUE = '__all__';
const RESOURCE_TYPES = ['user', 'session', 'folder', 'item'] as const;

export interface AuditFilterState {
  action: string;
  actor_user_id: string;
  resource_type: string;
  from: string;
  to: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const EMPTY_FILTERS: AuditFilterState = {
  action: '',
  actor_user_id: '',
  resource_type: '',
  from: '',
  to: '',
};

interface AuditFiltersProps {
  value: AuditFilterState;
  onChange(next: AuditFilterState): void;
  users: AdminUser[];
}

function localToISOZ(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function isoZToLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function AuditFilters({ value, onChange, users }: AuditFiltersProps) {
  const hasAnyFilter =
    !!value.action || !!value.actor_user_id || !!value.resource_type || !!value.from || !!value.to;

  function patch(part: Partial<AuditFilterState>) {
    onChange({ ...value, ...part });
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-md border bg-card/30 p-4 md:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1.5">
        <Label htmlFor="filter-action" className="text-xs uppercase text-muted-foreground">
          İşlem
        </Label>
        <Select
          value={value.action || ALL_VALUE}
          onValueChange={(v) => patch({ action: v === ALL_VALUE ? '' : v })}
        >
          <SelectTrigger id="filter-action">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Tümü</SelectItem>
            {ALL_AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a} className="font-mono text-xs">
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-actor" className="text-xs uppercase text-muted-foreground">
          Aktör
        </Label>
        <Select
          value={value.actor_user_id || ALL_VALUE}
          onValueChange={(v) => {
            if (v === ALL_VALUE) patch({ actor_user_id: '' });
            else patch({ actor_user_id: v });
          }}
        >
          <SelectTrigger id="filter-actor">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Tümü</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-resource" className="text-xs uppercase text-muted-foreground">
          Kaynak Tipi
        </Label>
        <Select
          value={value.resource_type || ALL_VALUE}
          onValueChange={(v) => patch({ resource_type: v === ALL_VALUE ? '' : v })}
        >
          <SelectTrigger id="filter-resource">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Tümü</SelectItem>
            {RESOURCE_TYPES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-from" className="text-xs uppercase text-muted-foreground">
          Başlangıç
        </Label>
        <Input
          id="filter-from"
          type="datetime-local"
          value={isoZToLocal(value.from)}
          onChange={(e) => patch({ from: localToISOZ(e.target.value) })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-to" className="text-xs uppercase text-muted-foreground">
          Bitiş
        </Label>
        <Input
          id="filter-to"
          type="datetime-local"
          value={isoZToLocal(value.to)}
          onChange={(e) => patch({ to: localToISOZ(e.target.value) })}
        />
      </div>

      {hasAnyFilter ? (
        <div className="lg:col-span-5">
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            <X className="mr-1 h-3 w-3" /> Filtreyi Temizle
          </Button>
        </div>
      ) : null}
    </div>
  );
}
