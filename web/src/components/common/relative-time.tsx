/**
 * RelativeTime — "2dk önce" gibi gösterim, hover'da tam ISO datetime tooltip.
 *
 * Audit log + user list "son giriş" alanlarında kullanılır. Türkçe
 * lokalizasyon manuel; Faz 5'te react-i18next eklenince Intl.RelativeTimeFormat
 * kullanılabilir.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RelativeTimeProps {
  iso: string | null | undefined;
  /** Fallback metin null/undefined girdide (örn. "Henüz giriş yapmadı"). */
  fallback?: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'birazdan';
  if (diff < MINUTE) return 'şimdi';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}dk önce`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}sa önce`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}g önce`;
  return date.toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function RelativeTime({ iso, fallback = '—' }: RelativeTimeProps) {
  if (!iso) return <span className="text-muted-foreground">{fallback}</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{formatRelative(date)}</span>
        </TooltipTrigger>
        <TooltipContent>{formatAbsolute(date)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
