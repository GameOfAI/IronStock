import * as React from 'react';
import type { Folder } from '@/api/types';

interface EntityFormStepProps {
  name: string;
  description: string;
  folderId: string;
  folders: Folder[];
  onChange: (patch: { name?: string; description?: string; folderId?: string }) => void;
}

export function EntityFormStep({
  name,
  description,
  folderId,
  folders,
  onChange,
}: EntityFormStepProps) {
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
      </div>
    </div>
  );
}
