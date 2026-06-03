import * as React from 'react';
import { Search, X, Plus } from 'lucide-react';
import type { RelationshipType } from '@/api/types';
import { useCatalogQuery } from '@/api/catalog-browser';
import { cn } from '@/lib/cn';

export interface PendingRelation {
  targetId: string;
  targetName: string;
  type: RelationshipType;
}

const REL_TYPES: { value: RelationshipType; label: string }[] = [
  { value: 'depends_on',    label: 'Bağımlı (depends on)' },
  { value: 'part_of',       label: 'Parçası (part of)' },
  { value: 'hosted_on',     label: 'Barındırılan (hosted on)' },
  { value: 'related_to',    label: 'İlişkili (related to)' },
  { value: 'uses_tool',     label: 'Araç (uses tool)' },
  { value: 'builds_to',     label: 'Build → (builds to)' },
  { value: 'deploys_to',    label: 'Deploy → (deploys to)' },
  { value: 'accessed_via',  label: 'Erişim (accessed via)' },
];

interface RelationStepProps {
  relations: PendingRelation[];
  onChange: (relations: PendingRelation[]) => void;
}

export function RelationStep({ relations, onChange }: RelationStepProps) {
  const [q, setQ] = React.useState('');
  const [relType, setRelType] = React.useState<RelationshipType>('depends_on');

  const { data, isLoading } = useCatalogQuery({ q, kind: null });
  const results = data?.items ?? [];

  function addRelation(targetId: string, targetName: string) {
    if (relations.find((r) => r.targetId === targetId && r.type === relType)) return;
    onChange([...relations, { targetId, targetName, type: relType }]);
    setQ('');
  }

  function removeRelation(idx: number) {
    onChange(relations.filter((_, i) => i !== idx));
  }

  const showResults = q.trim().length >= 2 && !isLoading;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-slate-200">İlişkiler (Opsiyonel)</h2>
        <p className="text-[13px] text-slate-500">
          Bu entity'nin diğer entity'lerle ilişkilerini ekleyin. İstediğiniz kadar ekleyebilirsiniz.
        </p>
      </div>

      {/* Existing relations */}
      {relations.length > 0 && (
        <div className="space-y-1">
          {relations.map((r, i) => (
            <div
              key={`${r.targetId}-${r.type}-${i}`}
              className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-[12px]"
            >
              <span className="font-mono text-slate-400">{r.type}</span>
              <span className="mx-1 text-slate-600">→</span>
              <span className="flex-1 truncate text-slate-200">{r.targetName}</span>
              <button
                type="button"
                onClick={() => removeRelation(i)}
                className="shrink-0 text-slate-500 hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add relation */}
      <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <p className="text-[12px] font-medium text-slate-400">İlişki ekle</p>

        <select
          value={relType}
          onChange={(e) => setRelType(e.target.value as RelationshipType)}
          className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-[12px] text-slate-200 focus:border-slate-500 focus:outline-none"
        >
          {REL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hedef entity ara… (en az 2 karakter)"
            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 pl-8 pr-3 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
          />
        </div>

        {showResults && results.length > 0 && (
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-800 rounded-md border border-slate-800">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addRelation(item.id, item.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-slate-800"
              >
                <Plus className="h-3 w-3 shrink-0 text-slate-500" />
                <span className="flex-1 truncate text-slate-200">{item.name}</span>
                {item.kind && (
                  <span className="shrink-0 font-mono text-[10px] uppercase text-slate-500">
                    {item.kind}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {showResults && results.length === 0 && (
          <p className="text-[11px] italic text-slate-600">
            &ldquo;{q}&rdquo; için eşleşen entity bulunamadı.
          </p>
        )}
      </div>

      {relations.length === 0 && (
        <p className={cn('text-center text-[12px] italic text-slate-600')}>
          Henüz ilişki eklenmedi. Bu adımı atlayabilirsiniz.
        </p>
      )}
    </div>
  );
}
