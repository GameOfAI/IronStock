import * as React from 'react';
import type { ItemType } from '@/api/types';
import { cn } from '@/lib/cn';
import {
  Server,
  Globe,
  Database,
  Key,
  ShieldCheck,
  Cloud,
  FileText,
  Lock,
  BookOpen,
} from 'lucide-react';

const KIND_META: Record<string, { icon: React.ElementType; description: string; color: string }> = {
  Server:           { icon: Server,     description: 'Fiziksel veya sanal sunucu kaydı',     color: 'text-blue-400' },
  Service:          { icon: Globe,      description: 'Web servisi, API veya uygulama',        color: 'text-violet-400' },
  Database:         { icon: Database,   description: 'Veritabanı bağlantısı ve bilgileri',    color: 'text-emerald-400' },
  SSHKey:           { icon: Key,        description: 'SSH anahtar çifti veya yetkisi',        color: 'text-amber-400' },
  Certificate:      { icon: ShieldCheck,description: 'TLS/SSL veya kod imzalama sertifikası', color: 'text-amber-400' },
  CloudCredential:  { icon: Cloud,      description: 'Bulut sağlayıcı erişim kimlik bilgisi', color: 'text-sky-400' },
  Note:             { icon: FileText,   description: 'Serbest metin notu veya belge',         color: 'text-slate-400' },
  Credential:       { icon: Lock,       description: 'Genel credential, parola veya token',   color: 'text-rose-400' },
};

interface TemplateSelectorProps {
  itemTypes: ItemType[];
  selectedItemTypeId: number | null;
  onSelect: (itemType: ItemType) => void;
}

export function TemplateSelector({ itemTypes, selectedItemTypeId, onSelect }: TemplateSelectorProps) {
  const withKind = itemTypes.filter((t) => t.kind_key);
  const withoutKind = itemTypes.filter((t) => !t.kind_key);

  function renderCard(t: ItemType) {
    const meta = t.kind_key ? KIND_META[t.kind_key] : null;
    const Icon = meta?.icon ?? BookOpen;
    const isSelected = t.id === selectedItemTypeId;

    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onSelect(t)}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4 text-left transition-all',
          isSelected
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900',
        )}
      >
        <div className={cn('mt-0.5 shrink-0', meta?.color ?? 'text-slate-400')}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className={cn('font-medium text-[13px]', isSelected ? 'text-slate-100' : 'text-slate-300')}>
            {t.kind_key ?? t.name}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {meta?.description ?? t.description ?? t.name}
          </p>
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-slate-200">Template Seç</h2>
        <p className="text-[13px] text-slate-500">
          Oluşturmak istediğiniz entity türünü seçin. Tür, entity'nin nasıl sınıflandırılacağını belirler.
        </p>
      </div>

      {withKind.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Catalog Türleri
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {withKind.map(renderCard)}
          </div>
        </div>
      )}

      {withoutKind.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Diğer Türler
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {withoutKind.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}
