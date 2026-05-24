/**
 * AccessRequestsPage — Onay/Checkout Workflow (PR-N3).
 *
 * Admin: lists ALL requests, can approve/deny pending ones.
 * Regular user: sees only their own requests (read-only history).
 */

import { useState } from 'react';
import {
  Check, X, Clock, ShieldCheck, ShieldX, CircleSlash, Loader2, RefreshCw,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore, selectIsAdmin } from '@/store/auth';
import {
  useAccessRequestsQuery,
  useApproveAccessRequestMutation,
  useDenyAccessRequestMutation,
} from '@/api/access-requests';
import type { AccessRequest } from '@/api/types';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

// ---- Status badge ----

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  pending:   { label: 'Bekliyor',    icon: Clock,       cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
  approved:  { label: 'Onaylandı',   icon: ShieldCheck, cls: 'text-green-600 bg-green-50 dark:bg-green-950/30' },
  denied:    { label: 'Reddedildi',  icon: ShieldX,     cls: 'text-red-600 bg-red-50 dark:bg-red-950/30' },
  expired:   { label: 'Süresi Doldu', icon: CircleSlash, cls: 'text-muted-foreground bg-muted' },
  cancelled: { label: 'İptal',       icon: X,           cls: 'text-muted-foreground bg-muted' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', cfg.cls)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ---- Approve dialog ----

function ApproveDialog({
  request,
  onClose,
}: {
  request: AccessRequest;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState(request.access_duration_minutes);
  const approveMut = useApproveAccessRequestMutation();

  async function handleApprove() {
    await approveMut.mutateAsync({
      reqId: request.id,
      body: { access_duration_minutes: duration },
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Erişim İsteğini Onayla</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p>
            <span className="font-medium">{request.requester_name || request.requester_id}</span> kullanıcısının{' '}
            <span className="font-medium">{request.item_name || request.item_id}</span> item'ı için isteği.
          </p>
          {request.reason && (
            <p className="text-muted-foreground italic">"{request.reason}"</p>
          )}
          <div className="space-y-1.5">
            <Label>Erişim Süresi (dakika)</Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Maksimum 1440 dk (24 saat). Kullanıcının talebi: {request.access_duration_minutes} dk.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button
            onClick={handleApprove}
            disabled={approveMut.isPending || duration <= 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {approveMut.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Onaylanıyor…</>
              : <><Check className="mr-2 h-4 w-4" />Onayla</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Deny dialog ----

function DenyDialog({ request, onClose }: { request: AccessRequest; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const denyMut = useDenyAccessRequestMutation();

  async function handleDeny() {
    await denyMut.mutateAsync({ reqId: request.id, body: { reason } });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Erişim İsteğini Reddet</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p>
            <span className="font-medium">{request.requester_name || request.requester_id}</span>
            {' '}kullanıcısının isteği reddedilecek.
          </p>
          <div className="space-y-1.5">
            <Label>Red Nedeni (opsiyonel)</Label>
            <Input
              placeholder="Neden reddedildiğini açıklayın…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button
            variant="destructive"
            onClick={handleDeny}
            disabled={denyMut.isPending}
          >
            {denyMut.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reddediliyor…</>
              : <><X className="mr-2 h-4 w-4" />Reddet</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main page ----

export default function AccessRequestsPage() {
  useDocumentTitle('Onay İstekleri');
  const isAdmin = useAuthStore(selectIsAdmin);
  const [statusFilter, setStatusFilter] = useState('');
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [denying, setDenying] = useState<AccessRequest | null>(null);

  const { data, isLoading, refetch } = useAccessRequestsQuery({ status: statusFilter || undefined });
  const requests = data?.requests ?? [];

  const pending = requests.filter((r) => r.status === 'pending');
  const other = requests.filter((r) => r.status !== 'pending');

  function relTime(iso: string) {
    try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: tr });
    } catch {
      return iso;
    }
  }

  function formatExpiry(iso?: string | null) {
    if (!iso) return '—';
    try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: tr });
    } catch {
      return iso;
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Onay İstekleri</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'Tüm kullanıcıların erişim isteklerini görüntüleyin ve onaylayın.'
              : 'Kendi erişim isteklerinizi takip edin.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Tüm durumlar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tüm durumlar</SelectItem>
              <SelectItem value="pending">Bekliyor</SelectItem>
              <SelectItem value="approved">Onaylandı</SelectItem>
              <SelectItem value="denied">Reddedildi</SelectItem>
              <SelectItem value="expired">Süresi Doldu</SelectItem>
              <SelectItem value="cancelled">İptal</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Onay isteği bulunamadı.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending section */}
          {pending.length > 0 && !statusFilter && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-amber-600 uppercase tracking-wide">
                Bekleyen İstekler ({pending.length})
              </h2>
              <div className="rounded-md border divide-y">
                {pending.map((req) => (
                  <RequestRow
                    key={req.id}
                    req={req}
                    isAdmin={isAdmin}
                    relTime={relTime}
                    formatExpiry={formatExpiry}
                    onApprove={() => setApproving(req)}
                    onDeny={() => setDenying(req)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* History section */}
          {(other.length > 0 || statusFilter) && (
            <div className="space-y-2">
              {!statusFilter && (
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Geçmiş
                </h2>
              )}
              <div className="rounded-md border divide-y">
                {(statusFilter ? requests : other).map((req) => (
                  <RequestRow
                    key={req.id}
                    req={req}
                    isAdmin={isAdmin}
                    relTime={relTime}
                    formatExpiry={formatExpiry}
                    onApprove={() => setApproving(req)}
                    onDeny={() => setDenying(req)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {approving && <ApproveDialog request={approving} onClose={() => setApproving(null)} />}
      {denying && <DenyDialog request={denying} onClose={() => setDenying(null)} />}
    </div>
  );
}

// ---- Row component ----

function RequestRow({
  req, isAdmin, relTime, formatExpiry, onApprove, onDeny,
}: {
  req: AccessRequest;
  isAdmin: boolean;
  relTime: (iso: string) => string;
  formatExpiry: (iso?: string | null) => string;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
      <StatusBadge status={req.status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{req.item_name || req.item_id}</span>
          {req.status === 'approved' && req.expires_at && (
            <span className="text-xs text-muted-foreground">
              ({formatExpiry(req.expires_at)} sona erer)
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
          {isAdmin && (
            <span>
              <span className="font-medium">{req.requester_name || req.requester_id}</span>
              {' '}tarafından
            </span>
          )}
          <span>{relTime(req.requested_at)}</span>
          <span>• {req.access_duration_minutes} dk talep edildi</span>
        </div>
        {req.reason && (
          <p className="text-xs text-muted-foreground italic mt-0.5">"{req.reason}"</p>
        )}
        {req.deny_reason && (
          <p className="text-xs text-red-500 mt-0.5">Red: {req.deny_reason}</p>
        )}
      </div>

      {isAdmin && req.status === 'pending' && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={onApprove}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Onayla
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2.5 text-xs"
            onClick={onDeny}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reddet
          </Button>
        </div>
      )}
    </div>
  );
}
