import * as React from 'react';
import type { Folder } from '@/api/types';

interface KindField {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
}

const KIND_FIELD_SCHEMAS: Record<string, KindField[]> = {
  Server: [
    { key: 'hostname', label: 'Hostname', required: true, placeholder: 'prod-app-01.example.com' },
    { key: 'ip_address', label: 'IP Adresi', placeholder: '10.0.1.100' },
    { key: 'os', label: 'İşletim Sistemi', placeholder: 'Ubuntu 22.04 LTS' },
  ],
  Database: [
    { key: 'engine', label: 'Veritabanı Motoru', required: true, placeholder: 'PostgreSQL' },
    { key: 'version', label: 'Versiyon', placeholder: '16.2' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '5432' },
  ],
  Service: [
    { key: 'url', label: 'Servis URL', required: true, placeholder: 'https://api.example.com' },
    { key: 'api_docs_url', label: 'API Docs URL', placeholder: 'https://api.example.com/docs' },
  ],
  Certificate: [
    { key: 'domain', label: 'Domain', required: true, placeholder: '*.example.com' },
    { key: 'issuer', label: 'CA / Issuer', placeholder: "Let's Encrypt" },
    { key: 'expires_at', label: 'Son Kullanma Tarihi', type: 'date' },
  ],
  SSHKey: [
    { key: 'hostname', label: 'Hedef Host', placeholder: 'bastion.example.com' },
    { key: 'username', label: 'Kullanıcı Adı', placeholder: 'deploy' },
  ],
  CloudCredential: [
    { key: 'provider', label: 'Cloud Sağlayıcı', required: true, placeholder: 'AWS / GCP / Azure' },
    { key: 'region', label: 'Bölge', placeholder: 'eu-west-1' },
  ],
};

interface EntityFormStepProps {
  name: string;
  description: string;
  folderId: string;
  folders: Folder[];
  kindKey?: string | null;
  kindFields?: Record<string, string>;
  onChange: (patch: {
    name?: string;
    description?: string;
    folderId?: string;
    kindFields?: Record<string, string>;
  }) => void;
}

export function EntityFormStep({
  name,
  description,
  folderId,
  folders,
  kindKey,
  kindFields = {},
  onChange,
}: EntityFormStepProps) {
  const schema = kindKey ? KIND_FIELD_SCHEMAS[kindKey] : undefined;

  function handleKindFieldChange(key: string, value: string) {
    onChange({ kindFields: { ...kindFields, [key]: value } });
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-slate-200">Entity Bilgileri</h2>
        <p className="text-[13px] text-slate-500">
          Temel metadata'yı doldurun. Şifreli alanları entity oluşturulduktan sonra ekleyebilirsiniz.
        </p>
      </div>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
            İsim <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="örn. prod-db-01, api-gateway, admin-cert"
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
            autoFocus
          />
          <p className="mt-1 text-[11px] text-slate-600">
            Kısa, betimleyici, benzersiz. Catalog URL'inde kullanılır.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
            Açıklama
          </label>
          <textarea
            value={description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Bu entity ne işe yarar? Kısaca açıklayın."
            rows={3}
            className="w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
          />
        </div>

        {/* Folder */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
            Klasör <span className="text-red-400">*</span>
          </label>
          {folders.length === 0 ? (
            <p className="text-[12px] text-amber-400">
              Henüz klasör yok. Önce Envanter'de bir klasör oluşturun.
            </p>
          ) : (
            <select
              value={folderId}
              onChange={(e) => onChange({ folderId: e.target.value })}
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-[13px] text-slate-200 focus:border-slate-500 focus:outline-none"
            >
              <option value="">— Klasör seçin —</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Kind-specific fields */}
        {schema && schema.length > 0 && (
          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {kindKey} Bilgileri
            </p>
            {schema.map((field) => (
              <div key={field.key}>
                <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
                  {field.label}
                  {field.required && <span className="text-red-400"> *</span>}
                </label>
                <input
                  type={field.type ?? 'text'}
                  value={kindFields[field.key] ?? ''}
                  onChange={(e) => handleKindFieldChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
