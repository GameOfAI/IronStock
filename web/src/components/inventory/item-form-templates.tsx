/**
 * Item Form Templates (PR-UX9)
 *
 * Yeni item oluştururken seçilebilecek hazır şablonlar.
 * Her şablon bir item tipi + opsiyonel ön-doldurma değerleri içerir.
 * Field key'ler DB seed'deki field_definitions.key'lere karşılık gelir.
 */

import {
  Box,
  Cloud,
  Database,
  FileText,
  Globe,
  Key,
  Lock,
  Server,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ItemTemplate {
  id: string;
  label: string;
  description: string;
  /** item_types.key */
  typeKey: string;
  /** Ön-doldurma: field key → string değeri */
  defaults: Record<string, string>;
  icon: React.ElementType;
  /** Renkli arka plan (Tailwind token) */
  color: string;
}

export const ITEM_TEMPLATES: ItemTemplate[] = [
  {
    id: 'mysql',
    label: 'MySQL',
    description: 'MySQL veritabanı bağlantısı',
    typeKey: 'database',
    defaults: { db_type: 'mysql', port: '3306', ssl_mode: 'prefer' },
    icon: Database,
    color: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'PostgreSQL veritabanı bağlantısı',
    typeKey: 'database',
    defaults: { db_type: 'postgres', port: '5432', ssl_mode: 'require' },
    icon: Database,
    color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  {
    id: 'linux-server',
    label: 'Linux Sunucu',
    description: 'SSH erişimli Linux sunucu',
    typeKey: 'server',
    defaults: { ssh_port: '22', os: 'Ubuntu 22.04', environment: 'prod', criticality: 'high' },
    icon: Server,
    color: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  },
  {
    id: 'ssh-key',
    label: 'SSH Anahtarı',
    description: 'Ed25519 / RSA özel anahtar',
    typeKey: 'ssh_key',
    defaults: { ssh_port: '22' },
    icon: Key,
    color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  },
  {
    id: 'aws',
    label: 'AWS',
    description: 'Amazon Web Services credential',
    typeKey: 'cloud_credential',
    defaults: { provider: 'aws', region: 'eu-central-1' },
    icon: Cloud,
    color: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  {
    id: 'gcp',
    label: 'GCP',
    description: 'Google Cloud Platform credential',
    typeKey: 'cloud_credential',
    defaults: { provider: 'gcp', region: 'europe-west1' },
    icon: Cloud,
    color: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  {
    id: 'certificate',
    label: 'Sertifika',
    description: 'TLS / SSL sertifikası',
    typeKey: 'certificate',
    defaults: {},
    icon: Shield,
    color: 'bg-green-500/10 text-green-500 border-green-500/20',
  },
  {
    id: 'api-key',
    label: 'API Key',
    description: 'REST API anahtarı / token',
    typeKey: 'url',
    defaults: { environment: 'prod' },
    icon: Lock,
    color: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  },
  {
    id: 'web-url',
    label: 'Web URL',
    description: 'Web uygulaması veya servis URL\'si',
    typeKey: 'url',
    defaults: { environment: 'prod' },
    icon: Globe,
    color: 'bg-teal-500/10 text-teal-500 border-teal-500/20',
  },
  {
    id: 'note',
    label: 'Not',
    description: 'Serbest metin / açıklama',
    typeKey: 'note',
    defaults: {},
    icon: FileText,
    color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  },
  {
    id: 'generic',
    label: 'Genel',
    description: 'Özel / tanımsız kayıt',
    typeKey: 'generic',
    defaults: {},
    icon: Box,
    color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  },
];

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
