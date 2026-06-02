/**
 * OnboardingTour — PR-PROD4: First-time user onboarding wizard.
 *
 * Shown once after a new admin completes bootstrap setup. Provides a guided
 * 4-step overview of the most important features:
 *
 *  Step 1 — Welcome: what IronStock is
 *  Step 2 — Create your first folder
 *  Step 3 — Add your first credential
 *  Step 4 — Invite your team
 *
 * Dismissed state is persisted to localStorage. The tour can be re-triggered
 * from the Help menu.
 *
 * Accessibility:
 *  - Focus is trapped inside the dialog while it is open.
 *  - Role="dialog" + aria-modal + aria-labelledby.
 *  - Escape key dismisses the tour.
 */

import * as React from 'react';
import {
  FolderPlus,
  KeyRound,
  Users,
  PartyPopper,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

// ─── LocalStorage key ─────────────────────────────────────────────────────────

const LS_KEY = 'ironstock_onboarding_dismissed';

// This file intentionally co-exports a hook + the tour component; the
// Fast-Refresh-only-components rule doesn't apply to this pairing.
// eslint-disable-next-line react-refresh/only-export-components
export function useOnboardingTour() {
  const [open, setOpen] = React.useState(() => {
    try {
      return !localStorage.getItem(LS_KEY);
    } catch {
      return false;
    }
  });

  const dismiss = React.useCallback(() => {
    try {
      localStorage.setItem(LS_KEY, '1');
    } catch { /* storage not available */ }
    setOpen(false);
  }, []);

  const reopen = React.useCallback(() => {
    setOpen(true);
  }, []);

  return { open, dismiss, reopen };
}

// ─── Tour step data ───────────────────────────────────────────────────────────

interface TourStep {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description: string;
  tip?: string;
}

const STEPS: TourStep[] = [
  {
    icon: PartyPopper,
    iconColor: 'text-primary',
    title: 'IronStock\'a Hoş Geldiniz 🎉',
    description:
      'IronStock, takımınız için merkezi ve uçtan uca şifreli bir credential vault\'u. Sunucular, veritabanları, API anahtarları ve daha fazlasını güvenle saklayın.',
    tip: 'Tüm veriler client-side şifrelenir — sunucu hiçbir zaman düz metin görmez.',
  },
  {
    icon: FolderPlus,
    iconColor: 'text-blue-500',
    title: 'Klasör Yapısı Oluşturun',
    description:
      'Klasörler, credential\'larınızı organize etmenin temel yoludur. "Üretim", "Geliştirme", "DevOps" gibi klasörler oluşturun ve takım bazında erişim izni verin.',
    tip: 'Envanter sayfasındaki + düğmesiyle hemen başlayabilirsiniz.',
  },
  {
    icon: KeyRound,
    iconColor: 'text-amber-500',
    title: 'İlk Credential\'ınızı Ekleyin',
    description:
      'Şifreler, SSH anahtarları, API token\'ları, veritabanı bağlantı bilgileri... Her şey için şablon hazır. Oluşturduğunuzda değerler otomatik olarak şifrelenir.',
    tip: '11 farklı item tipi var: Sunucu, Veritabanı, SSH Anahtarı, API Key, Not ve daha fazlası.',
  },
  {
    icon: Users,
    iconColor: 'text-green-500',
    title: 'Takımınızı Davet Edin',
    description:
      'Admin → Kullanıcılar sayfasından yeni kullanıcı oluşturun. Klasörlere ve item\'lara granüler izinler verin. Gruplar ile toplu izin yönetimi yapın.',
    tip: 'Güvenlik için her kullanıcıya TOTP (Google Authenticator) zorunlu kılabilirsiniz.',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface OnboardingTourProps {
  open: boolean;
  onDismiss: () => void;
}

export function OnboardingTour({ open, onDismiss }: OnboardingTourProps) {
  const [step, setStep] = React.useState(0);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  // Reset to step 0 when re-opened.
  React.useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Focus trap and Escape key.
  React.useEffect(() => {
    if (!open) return;

    const el = dialogRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onDismiss(); return; }
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;
  const isFirst = step === 0;

  const StepIcon = current.icon;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-xl bg-background border border-border shadow-xl p-6 outline-none"
      >
        {/* Close button */}
        <button
          type="button"
          className="absolute top-3 right-3 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Turu kapat"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-5" aria-label={`Adım ${step + 1} / ${STEPS.length}`}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-lg bg-muted p-2.5 shrink-0">
            <StepIcon className={cn('h-6 w-6', current.iconColor)} aria-hidden="true" />
          </div>
          <h2 id={titleId} className="text-lg font-semibold leading-tight">
            {current.title}
          </h2>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {current.description}
        </p>

        {/* Tip */}
        {current.tip && (
          <div className="mt-3 rounded-md bg-muted/50 border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">💡 İpucu:</span>{' '}
              {current.tip}
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={isFirst}
            onClick={() => setStep(s => s - 1)}
            aria-label="Önceki adım"
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            Önceki
          </Button>

          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {step + 1} / {STEPS.length}
          </span>

          {isLast ? (
            <Button size="sm" onClick={onDismiss}>
              Başla 🚀
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setStep(s => s + 1)}
              aria-label="Sonraki adım"
            >
              Sonraki
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
