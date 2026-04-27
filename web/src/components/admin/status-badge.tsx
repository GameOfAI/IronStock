/**
 * StatusBadge — kullanıcı durumu için renkli badge.
 *
 * Status değerleri server users.status CHECK constraint'i ile aynı.
 * (active / pending_totp / disabled / locked)
 */

import { Badge } from '@/components/ui/badge';
import type { AdminUser } from '@/api/types';
import { cn } from '@/lib/cn';

interface StatusBadgeProps {
  status: AdminUser['status'];
}

const STATUS_LABEL: Record<AdminUser['status'], string> = {
  active: 'Aktif',
  pending_totp: 'TOTP Bekliyor',
  disabled: 'Devre Dışı',
  locked: 'Kilitli',
};

const STATUS_CLASS: Record<AdminUser['status'], string> = {
  active:
    'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300',
  pending_totp:
    'border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-700 dark:text-amber-300',
  disabled: 'border-red-300 bg-red-500/10 text-red-700 dark:border-red-700 dark:text-red-300',
  locked:
    'border-slate-300 bg-slate-500/10 text-slate-700 dark:border-slate-700 dark:text-slate-300',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('font-medium', STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
