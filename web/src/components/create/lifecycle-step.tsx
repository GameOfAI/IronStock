import * as React from 'react';
import type { LifecycleStage } from '@/api/types';
import { cn } from '@/lib/cn';

const STAGE_COLORS: Record<string, string> = {
  plan:    'border-purple-500/40 text-purple-300 data-[active=true]:bg-purple-600 data-[active=true]:border-purple-500 data-[active=true]:text-white',
  code:    'border-blue-500/40 text-blue-300 data-[active=true]:bg-blue-600 data-[active=true]:border-blue-500 data-[active=true]:text-white',
  build:   'border-orange-500/40 text-orange-300 data-[active=true]:bg-orange-600 data-[active=true]:border-orange-500 data-[active=true]:text-white',
  test:    'border-yellow-500/40 text-yellow-300 data-[active=true]:bg-yellow-600 data-[active=true]:border-yellow-500 data-[active=true]:text-white',
  release: 'border-green-500/40 text-green-300 data-[active=true]:bg-green-600 data-[active=true]:border-green-500 data-[active=true]:text-white',
  deploy:  'border-teal-500/40 text-teal-300 data-[active=true]:bg-teal-600 data-[active=true]:border-teal-500 data-[active=true]:text-white',
  operate: 'border-indigo-500/40 text-indigo-300 data-[active=true]:bg-indigo-600 data-[active=true]:border-indigo-500 data-[active=true]:text-white',
  monitor: 'border-pink-500/40 text-pink-300 data-[active=true]:bg-pink-600 data-[active=true]:border-pink-500 data-[active=true]:text-white',
};

interface LifecycleStepProps {
  stages: LifecycleStage[];
  selectedStageIds: number[];
  onChange: (ids: number[]) => void;
}

export function LifecycleStep({ stages, selectedStageIds, onChange }: LifecycleStepProps) {
  function toggle(id: number) {
    if (selectedStageIds.includes(id)) {
      onChange(selectedStageIds.filter((s) => s !== id));
    } else {
      onChange([...selectedStageIds, id]);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-slate-200">Lifecycle Aşamaları (Opsiyonel)</h2>
        <p className="text-[13px] text-slate-500">
          Bu entity'nin bulunduğu DevOps aşamalarını seçin. Birden fazla seçebilirsiniz.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((stage) => {
          const isActive = selectedStageIds.includes(stage.id);
          const colorClass = STAGE_COLORS[stage.key] ?? 'border-slate-700 text-slate-400 data-[active=true]:bg-slate-700 data-[active=true]:text-white';
          return (
            <button
              key={stage.id}
              type="button"
              data-active={isActive}
              onClick={() => toggle(stage.id)}
              className={cn(
                'rounded-md border px-3 py-3 text-center text-[12px] font-medium transition-all',
                colorClass,
                !isActive && 'bg-slate-900/30',
              )}
            >
              <p>{stage.label}</p>
              {stage.key && (
                <p className="mt-0.5 font-mono text-[10px] uppercase opacity-60">{stage.key}</p>
              )}
            </button>
          );
        })}
      </div>

      {selectedStageIds.length === 0 && (
        <p className="text-center text-[12px] italic text-slate-600">
          Aşama seçilmedi. Bu adımı atlayabilirsiniz.
        </p>
      )}
    </div>
  );
}
