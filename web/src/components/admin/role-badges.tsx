/**
 * RoleBadges — kullanıcının rollerini badge group olarak gösterir.
 *
 * 3 rol mümkün: admin (yetki vurgusu, dolgulu) / write / read (outline).
 * Boş roller için "—" placeholder.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

interface RoleBadgesProps {
  roles: string[];
}

const ROLE_ORDER = ['admin', 'write', 'read'] as const;

const ROLE_CLASS: Record<string, string> = {
  admin: 'bg-blue-600 text-white border-blue-700 hover:bg-blue-600',
  write:
    'border-purple-300 text-purple-700 bg-transparent dark:border-purple-700 dark:text-purple-300',
  read: 'border-slate-300 text-slate-600 bg-transparent dark:border-slate-700 dark:text-slate-300',
};

export function RoleBadges({ roles }: RoleBadgesProps) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const sorted = [...roles].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a as (typeof ROLE_ORDER)[number]) -
      ROLE_ORDER.indexOf(b as (typeof ROLE_ORDER)[number]),
  );
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((role) => (
        <Badge
          key={role}
          variant={role === 'admin' ? 'default' : 'outline'}
          className={cn('font-medium', ROLE_CLASS[role])}
        >
          {role}
        </Badge>
      ))}
    </div>
  );
}
