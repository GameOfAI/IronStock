import { Eye, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Permission } from '@/api/types';
import { cn } from '@/lib/cn';

interface PermissionBadgeProps {
  permission: Permission;
  compact?: boolean;
}

export function PermissionBadge({ permission, compact = false }: PermissionBadgeProps) {
  if (permission === 'write') {
    return (
      <Badge
        variant="default"
        className={cn('gap-1 bg-blue-600 text-white hover:bg-blue-600', compact ? 'h-5 px-1.5 text-[10px]' : '')}
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
