/**
 * Item Form Template gallery component (PR-UX9).
 * Sadece React component — veri item-form-template-data.ts dosyasında (react-refresh uyumlu ayrım).
 */

import { cn } from '@/lib/cn';
import { ITEM_TEMPLATES, type ItemTemplate } from './item-form-template-data';

export type { ItemTemplate };

interface TemplateGalleryProps {
  onSelect: (tpl: ItemTemplate) => void;
  onSkip: () => void;
}

export function TemplateGallery({ onSelect, onSkip }: TemplateGalleryProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Hazır bir şablon seçin ya da boş başlayın:
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Boş başla
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ITEM_TEMPLATES.map((tpl) => {
          const Icon = tpl.icon;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelect(tpl)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all',
                'hover:shadow-sm hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                tpl.color,
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="text-xs font-semibold leading-tight">{tpl.label}</p>
                <p className="text-[10px] opacity-70 leading-tight mt-0.5">{tpl.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
