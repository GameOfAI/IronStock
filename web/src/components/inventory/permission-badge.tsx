/**
 * PermissionBadge — item satırlarında ve folder header'da etkili izni gösterir.
 *
 * Server `permission` alanı '' (none) | 'read' | 'write' döner. None ise
 * (admin bypass dışında) endpoint zaten 404/403 verir, yani UI'da görmemeli.
 */

import { Eye, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Permission } from '@/api/types';
import { cn } from '@/lib/cn';

interface PermissionBadgeProps {
  permission: Permission;
  /** Compact mode — sadece icon + harf (table cell). */
  compact?: boolean;
}

export function PermissionBadge({ permission, compact = false }: PermissionBadgeProps) {
  if (permission === 'write') {
    return (
      <Badge
        variant="default"
        className={cn(
          'gap-1 bg-blue-600 text-white hover:bg-blue-600',
          compact ? 'h-5 px-1.5 text-[10px]' : '',
        )}
      >
        <Pencil className="h-3 w-3" aria-hidden />
        {compact ? 'W' : 'write'}
      </Badge>
    );
  }
  if (permission === 'read') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'gap-1 border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300',
          compact ? 'h-5 px-1.5 text-[10px]' : '',
        )}
      >
        <Eye className="h-3 w-3" aria-hidden />
        {compact ? 'R' : 'read'}
      </Badge>
    );
  }
  return null;
}
