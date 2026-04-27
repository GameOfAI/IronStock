/**
 * ItemSearch — debounced search input for the item list.
 *
 * Server HMAC blind-index search → exact match (substring değil). UI'da
 * "Tam isim girin (ör. mysql-prod)" hint'i gösteriyoruz, false negative
 * sürpriz olmasın.
 *
 * 300ms debounce; üst component her commit'te `onCommit` ile URL search
 * params'a yazar.
 */

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ItemSearchProps {
  initial: string;
  onCommit(value: string): void;
  disabled?: boolean;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;

export function ItemSearch({
  initial,
  onCommit,
  disabled,
  placeholder = 'Tam item adı (ör. mysql-prod)',
}: ItemSearchProps) {
  const [draft, setDraft] = useState(initial);
  const lastCommittedRef = useRef(initial);

  // Sync inbound URL changes back to local input
  useEffect(() => {
    if (initial !== lastCommittedRef.current) {
      setDraft(initial);
      lastCommittedRef.current = initial;
    }
  }, [initial]);

  // Debounced commit
  useEffect(() => {
    if (draft === lastCommittedRef.current) return;
    const handle = window.setTimeout(() => {
      lastCommittedRef.current = draft;
      onCommit(draft.trim());
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, onCommit]);

  return (
    <div className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="pl-9 pr-9"
        aria-label="Item ara"
      />
      {draft ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
          onClick={() => setDraft('')}
          disabled={disabled}
          aria-label="Aramayı temizle"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
