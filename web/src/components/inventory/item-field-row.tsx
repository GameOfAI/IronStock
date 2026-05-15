/**
 * ItemFieldRow — bir item'ın tek field'ını gösterir.
 *
 * Decryption ItemDetail'da yapılır; bu component sadece görüntüler.
 * - is_secret veya key === 'username' → maskeli + göz toggle
 * - Diğer alanlar → düz metin
 */

import { useState } from 'react';
import { Eye, EyeOff, Lock, Loader2, Copy, Check } from 'lucide-react';
import type { FieldDefinition, ItemFieldOutput } from '@/api/types';
import { cn } from '@/lib/cn';

interface ItemFieldRowProps {
  field: ItemFieldOutput;
  definition: FieldDefinition | undefined;
  /** Decrypted plaintext value, or null when not (yet) available. */
  decryptedValue: string | null;
  decryptionStatus: 'idle' | 'pending' | 'success' | 'error';
}

const MASK = '••••••••••';

export function ItemFieldRow({
  field,
  definition,
  decryptedValue,
  decryptionStatus,
}: ItemFieldRowProps) {
  const label = definition?.label ?? `field:${field.field_definition_id}`;
  const key = definition?.key;
  const fieldType = definition?.field_type;
  const isSecret = definition?.is_secret ?? false;
  // Treat username as secret-by-default per UI policy.
  const isHidden = isSecret || key === 'username';

  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!decryptedValue) return;
    try {
      await navigator.clipboard.writeText(decryptedValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignored
    }
  }

  const showLoader = decryptionStatus === 'pending';
  const showLock = decryptionStatus === 'error' || decryptionStatus === 'idle';

  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 border-b py-2 last:border-b-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {key ? (
          <div className="font-mono text-[10px] uppercase text-muted-foreground">
            {key}
            {fieldType ? <span className="ml-1">· {fieldType}</span> : null}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          'flex items-center gap-2 text-sm',
          isHidden ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {showLoader ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            <span className="font-mono text-xs italic">çözülüyor…</span>
          </>
        ) : showLock || decryptedValue === null ? (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-mono text-xs">Şifreli</span>
          </>
        ) : isHidden ? (
          <>
            <span
              className={cn(
                'font-mono text-sm break-all',
                visible ? 'text-foreground' : 'tracking-wider text-muted-foreground',
              )}
            >
              {visible ? decryptedValue : MASK}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label={visible ? 'Gizle' : 'Göster'}
                onClick={() => setVisible((v) => !v)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {visible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                aria-label="Kopyala"
                onClick={handleCopy}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="break-all">{decryptedValue}</span>
            <button
              type="button"
              aria-label="Kopyala"
              onClick={handleCopy}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
