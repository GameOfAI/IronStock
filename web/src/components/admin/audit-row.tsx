/**
 * AuditRow — audit log tablosunda tek satır.
 *
 * `details` JSON object (server `Record<string, unknown>` döndürüyor) inline
 * collapsible olarak açılır. Birden fazla row aynı anda açılabilir; modal
 * yerine inline expansion bilinçli karar (audit araştırması pattern'i).
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import type { AuditLogEntry } from '@/api/types';
import { ActionIcon } from './action-icon';
import { RelativeTime } from '@/components/common/relative-time';

interface AuditRowProps {
  entry: AuditLogEntry;
  /** username lookup map (id → username). PR'da userMap denir. */
  userMap: Record<string, string>;
}

function ActorLabel({ actorId, userMap }: { actorId: string | null | undefined; userMap: Record<string, string> }) {
  if (!actorId) return <span className="italic text-muted-foreground">Sistem</span>;
  const name = userMap[actorId];
  if (!name) {
    return (
      <span className="italic text-muted-foreground" title={actorId}>
        silinmiş kullanıcı
      </span>
    );
  }
  return <span>{name}</span>;
}

function ResourceLabel({ entry }: { entry: AuditLogEntry }) {
  if (!entry.resource_type) return <span className="text-muted-foreground">—</span>;
  if (!entry.resource_id) return <span className="font-mono text-xs">{entry.resource_type}</span>;
  // Truncate UUIDs for readability
  const idShort = entry.resource_id.length > 12 ? `${entry.resource_id.slice(0, 8)}…` : entry.resource_id;
  return (
    <span className="font-mono text-xs" title={entry.resource_id}>
      {entry.resource_type}:{idShort}
    </span>
  );
}

const HAS_DETAIL_KEYS_FALLBACK = false;

function hasDetails(entry: AuditLogEntry): boolean {
  if (entry.details && Object.keys(entry.details).length > 0) return true;
  if (entry.ip_address) return true;
  if (entry.user_agent) return true;
  return HAS_DETAIL_KEYS_FALLBACK;
}

function buildDetailObject(entry: AuditLogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(entry.details ?? {}) };
  if (entry.ip_address) out.ip_address = entry.ip_address;
  if (entry.user_agent) out.user_agent = entry.user_agent;
  return out;
}

export function AuditRow({ entry, userMap }: AuditRowProps) {
  const [open, setOpen] = useState(false);
  const expandable = hasDetails(entry);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <>
        <TableRow data-state={open ? 'open' : undefined}>
          <TableCell className="w-[140px]">
            <RelativeTime iso={entry.created_at} />
          </TableCell>
          <TableCell className="w-[140px]">
            <ActorLabel actorId={entry.actor_user_id} userMap={userMap} />
          </TableCell>
          <TableCell>
            <ActionIcon action={entry.action} />
          </TableCell>
          <TableCell>
            <ResourceLabel entry={entry} />
          </TableCell>
          <TableCell className="w-[60px] text-right">
            {expandable ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={open ? 'Detayları gizle' : 'Detayları göster'}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', open && 'rotate-90')}
                />
              </Button>
            ) : null}
          </TableCell>
        </TableRow>
        {expandable ? (
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={5} className="p-0">
              <CollapsibleContent>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs">
                  {JSON.stringify(buildDetailObject(entry), null, 2)}
                </pre>
              </CollapsibleContent>
            </TableCell>
          </TableRow>
        ) : null}
      </>
    </Collapsible>
  );
}
