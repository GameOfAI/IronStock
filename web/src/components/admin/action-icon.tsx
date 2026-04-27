/**
 * ActionIcon — audit log "action" alanını icon + renkli label ile renderler.
 *
 * Server'daki audit constants'ı (audit/audit.go) buradaki tabloyla
 * eşleştirilmiştir. Bilinmeyen action'lar için generic activity ikonu.
 */

import {
  Activity,
  FileText,
  Folder,
  KeyRound,
  LifeBuoy,
  LogIn,
  LogOut,
  Lock,
  Package,
  RefreshCcw,
  Share2,
  Shield,
  ShieldOff,
  UserCog,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface ActionIconProps {
  action: string;
}

interface ActionMeta {
  Icon: React.ComponentType<{ className?: string }>;
  /** Tailwind text-* class for the icon + label color. */
  color: string;
  /** Display label (Turkish). */
  label: string;
}

const ACTION_TABLE: Record<string, ActionMeta> = {
  'auth.register': { Icon: UserCog, color: 'text-blue-600', label: 'auth.register' },
  'auth.totp_init': { Icon: KeyRound, color: 'text-amber-600', label: 'auth.totp_init' },
  'auth.totp_verified': { Icon: KeyRound, color: 'text-emerald-600', label: 'auth.totp_verified' },
  'auth.login': { Icon: LogIn, color: 'text-emerald-600', label: 'auth.login' },
  'auth.login_fail': { Icon: LogIn, color: 'text-red-600', label: 'auth.login_fail' },
  'auth.logout': { Icon: LogOut, color: 'text-slate-600', label: 'auth.logout' },
  'auth.logout_all': { Icon: LogOut, color: 'text-slate-700', label: 'auth.logout_all' },
  'auth.refresh': { Icon: RefreshCcw, color: 'text-blue-500', label: 'auth.refresh' },
  'auth.refresh_reuse_detected': {
    Icon: RefreshCcw,
    color: 'text-red-700',
    label: 'auth.refresh_reuse_detected',
  },
  'auth.password_changed': {
    Icon: KeyRound,
    color: 'text-amber-700',
    label: 'auth.password_changed',
  },
  'auth.recover': { Icon: LifeBuoy, color: 'text-amber-600', label: 'auth.recover' },
  'auth.recover_fail': { Icon: LifeBuoy, color: 'text-red-600', label: 'auth.recover_fail' },
  'auth.session_binding_changed': {
    Icon: Activity,
    color: 'text-amber-500',
    label: 'auth.session_binding_changed',
  },
  'folder.created': { Icon: Folder, color: 'text-indigo-600', label: 'folder.created' },
  'folder.updated': { Icon: Folder, color: 'text-indigo-500', label: 'folder.updated' },
  'folder.deleted': { Icon: Folder, color: 'text-red-600', label: 'folder.deleted' },
  'folder.permission_granted': {
    Icon: Shield,
    color: 'text-indigo-700',
    label: 'folder.permission_granted',
  },
  'folder.permission_revoked': {
    Icon: ShieldOff,
    color: 'text-rose-600',
    label: 'folder.permission_revoked',
  },
  'item.created': { Icon: Package, color: 'text-violet-600', label: 'item.created' },
  'item.updated': { Icon: Package, color: 'text-violet-500', label: 'item.updated' },
  'item.deleted': { Icon: Package, color: 'text-red-600', label: 'item.deleted' },
  'item.field_updated': { Icon: FileText, color: 'text-violet-500', label: 'item.field_updated' },
  'item.shared': { Icon: Share2, color: 'text-emerald-600', label: 'item.shared' },
  'item.unshared': { Icon: Share2, color: 'text-rose-600', label: 'item.unshared' },
  'admin.user_disabled': { Icon: Lock, color: 'text-rose-700', label: 'admin.user_disabled' },
  'admin.user_enabled': { Icon: Lock, color: 'text-emerald-700', label: 'admin.user_enabled' },
  'admin.role_granted': { Icon: Shield, color: 'text-blue-700', label: 'admin.role_granted' },
  'admin.role_revoked': { Icon: ShieldOff, color: 'text-rose-700', label: 'admin.role_revoked' },
};

export function ActionIcon({ action }: ActionIconProps) {
  const meta = ACTION_TABLE[action] ?? {
    Icon: Activity,
    color: 'text-muted-foreground',
    label: action,
  };
  const { Icon, color, label } = meta;
  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-xs', color)}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** Action key list for filter dropdown. Sorted by namespace. */
export const ALL_AUDIT_ACTIONS = Object.keys(ACTION_TABLE).sort();
