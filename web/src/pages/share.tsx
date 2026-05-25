/**
 * Public Share Page — PR-N5: One-Time Share Link viewer.
 *
 * URL format: /share/{token}#{base64url(link_key)}
 *
 * The link_key is read from the URL fragment (window.location.hash).
 * It is NEVER sent to the server. The server only receives the token
 * (in the request path) to look up the encrypted payload.
 *
 * Crypto flow:
 *   1. Read link_key from URL fragment.
 *   2. Fetch encrypted payload from GET /api/v1/share/{token} (no auth).
 *   3. Decrypt DEK: decryptPrivateKey(dek_wrapped, link_key).
 *   4. Decrypt each secret field: decryptField(value_enc, value_nonce, dek).
 *   5. Display results — no login required.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Copy, Eye, EyeOff, Loader2, Lock, Package, Shield, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  fromBase64,
  decryptPrivateKey,
  decryptField,
} from '@/lib/crypto';
import { useShareLinkViewQuery } from '@/api/share-links';
import { ApiError } from '@/api/errors';
import type { ShareLinkField } from '@/api/types';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

// ── helpers ──────────────────────────────────────────────────────────────────

/** URL-safe base64 → standard base64 → Uint8Array. */
function fromBase64url(b64url: string): Uint8Array {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, '=');
  return fromBase64(b64);
}

function readLinkKey(): Uint8Array | null {
  const hash = window.location.hash.slice(1); // remove leading '#'
  if (!hash) return null;
  try {
    const bytes = fromBase64url(hash);
    if (bytes.length !== 32) return null;
    return bytes;
  } catch {
    return null;
  }
}

// ── field display ─────────────────────────────────────────────────────────────

interface DecryptedFieldRowProps {
  field: ShareLinkField;
  dek: Uint8Array | null;
}

function DecryptedFieldRow({ field, dek }: DecryptedFieldRowProps) {
  const [value, setValue] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!field.is_secret || !dek || !field.value_enc || !field.value_nonce) return;
    let cancelled = false;
    (async () => {
      try {
        const enc = fromBase64(field.value_enc!);
        const nonce = fromBase64(field.value_nonce!);
        const plain = await decryptField(enc, nonce, dek);
        if (!cancelled) setValue(plain);
      } catch {
        if (!cancelled) setDecryptError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [field, dek]);

  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Kopyalandı!' });
    } catch {
      toast({ title: 'Kopyalanamadı', variant: 'destructive' });
    }
  }

  const displayValue = !field.is_secret
    ? '(sunucu tarafında saklanmıyor)'
    : decryptError
      ? '(şifre çözme hatası)'
      : value === null
        ? null
        : revealed
          ? value
          : '••••••••';

  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{field.label}</span>
          {field.is_secret && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
              <Lock className="h-2.5 w-2.5" aria-hidden />
              Gizli
            </Badge>
          )}
        </div>
        {field.is_secret ? (
          <div className="flex items-center gap-2">
            {value === null && !decryptError ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Çözülüyor…
              </span>
            ) : (
              <span className="font-mono text-sm break-all">
                {displayValue}
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground italic">
            Bu alan gizli değil — değeri burada gösterilmiyor.
          </span>
        )}
      </div>

      {field.is_secret && value !== null && !decryptError && (
        <div className="flex gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title={revealed ? 'Gizle' : 'Göster'}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed
              ? <EyeOff className="h-3.5 w-3.5" aria-hidden />
              : <Eye className="h-3.5 w-3.5" aria-hidden />
            }
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Kopyala"
            onClick={copyValue}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function SharePage() {
  useDocumentTitle('Paylaşım Bağlantısı');
  const { token } = useParams<{ token: string }>();
  const [linkKey, setLinkKey] = useState<Uint8Array | null>(null);
  const [keyInitialized, setKeyInitialized] = useState(false);
  const [dek, setDek] = useState<Uint8Array | null>(null);
  const [dekError, setDekError] = useState<string | null>(null);

  // Read link_key from URL fragment on mount.
  useEffect(() => {
    const key = readLinkKey();
    setLinkKey(key);
    setKeyInitialized(true);
  }, []);

  // Fetch encrypted payload from the server (public endpoint, no auth).
  const viewQuery = useShareLinkViewQuery(token ?? null);
  const payload = viewQuery.data;

  // Decrypt the DEK once payload + link_key are available.
  useEffect(() => {
    if (!payload || !linkKey) return;
    let cancelled = false;
    (async () => {
      try {
        const dekWrapped = fromBase64(payload.dek_wrapped);
        const itemDEK = await decryptPrivateKey(dekWrapped, linkKey);
        if (!cancelled) setDek(itemDEK);
      } catch (err) {
        if (!cancelled) {
          setDekError(
            userFriendlyError(err),
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [payload, linkKey]);

  // ── render states ────────────────────────────────────────────────────────

  if (!token) {
    return <ErrorScreen title="Geçersiz link" message="Token bulunamadı." />;
  }

  if (!keyInitialized) {
    return <LoadingScreen message="Link anahtarı okunuyor…" />;
  }

  if (!linkKey) {
    return (
      <ErrorScreen
        title="Eksik anahtar"
        message="Link anahtarı URL'de bulunamadı. Linkin tam kopyalandığından emin olun (# işareti dahil)."
      />
    );
  }

  if (viewQuery.isLoading) {
    return <LoadingScreen message="Link doğrulanıyor…" />;
  }

  if (viewQuery.isError) {
    const err = viewQuery.error;
    const isExpired = err instanceof ApiError && err.code === 'link_expired';
    return (
      <ErrorScreen
        icon={isExpired ? 'expired' : 'error'}
        title={isExpired ? 'Link kullanılamaz' : 'Link yüklenemedi'}
        message={
          isExpired
            ? 'Bu link kullanılmış, görüntüleme sayısı dolmuş veya süresi geçmiş.'
            : 'Sunucudan yanıt alınamadı. Lütfen daha sonra tekrar deneyin.'
        }
      />
    );
  }

  if (!payload) return null;

  const expiresAt = new Date(payload.expires_at);
  const isExpiringSoon = expiresAt.getTime() - Date.now() < 60 * 60 * 1000; // < 1 hour

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3 flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" aria-hidden />
        <span className="font-semibold text-sm">Güvenli Paylaşım</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Envanter App
        </span>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Item header */}
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-muted p-2.5">
              <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{payload.item_name}</h1>
              <p className="text-sm text-muted-foreground">{payload.item_type_label}</p>
            </div>
          </div>

          {/* Metadata badges */}
          <div className="flex flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-muted-foreground">
              <Eye className="h-3 w-3" aria-hidden />
              {payload.views_left} görüntüleme hakkı kaldı
            </div>
            <div className={`flex items-center gap-1 rounded-full border px-2.5 py-1 ${isExpiringSoon ? 'border-amber-300 text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
              <Clock className="h-3 w-3" aria-hidden />
              {expiresAt.toLocaleString('tr-TR', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </div>

        {/* DEK decryption error */}
        {dekError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium">Alan değerleri çözülemedi</p>
              <p className="text-xs mt-1">{dekError}</p>
            </div>
          </div>
        )}

        {/* Fields */}
        <div className="rounded-lg border bg-card divide-y">
          {payload.fields.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center italic">
              Bu item'da gösterilecek alan yok.
            </p>
          ) : (
            <div className="px-4">
              {payload.fields.map((f, i) => (
                <DecryptedFieldRow
                  key={`${f.key}-${i}`}
                  field={f}
                  dek={dekError ? null : dek}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer notice */}
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Bu sayfa şifreli bir paylaşım linki ile açıldı.
          Alan değerleri tarayıcınızda çözülüyor; sunucu düz metin görmez.
        </p>
      </main>
    </div>
  );
}

// ── helper screens ────────────────────────────────────────────────────────────

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ErrorScreen({
  title,
  message,
  icon = 'error',
}: {
  title: string;
  message: string;
  icon?: 'expired' | 'error';
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      {icon === 'expired'
        ? <ShieldOff className="h-12 w-12 text-muted-foreground" aria-hidden />
        : <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden />
      }
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      </div>
    </div>
  );
}
