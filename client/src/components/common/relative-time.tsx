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

interface RelativeTimeProps {
  iso: string | null | undefined;
  fallback?: string;
}

export function RelativeTime({ iso, fallback = '—' }: RelativeTimeProps) {
  if (!iso) return <span className="text-muted-foreground">{fallback}</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <time dateTime={iso} title={date.toLocaleString('tr-TR')}>
      {formatRelative(date)}
    </time>
  );
}
