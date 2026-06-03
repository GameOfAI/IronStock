/**
 * EntityHeader — Backstage-style entity page header (PR-DP06).
 * Shows kind breadcrumb, entity name, owner chip, description, lifecycle rail.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLifecycleStagesQuery, useItemLifecycleStagesQuery } from '@/api/lifecycle';
import type { Item } from '@/api/types';

interface EntityHeaderProps {
  item: Item;
  /** Extra actions rendered in the header action bar */
  actions?: React.ReactNode;
}

export function EntityHeader({ item, actions }: EntityHeaderProps) {
  const { data: stagesData } = useLifecycleStagesQuery();
  const { data: itemStagesData } = useItemLifecycleStagesQuery(item.id);

  const assignedStageIds = new Set(itemStagesData?.stage_ids ?? []);
  const allStages = stagesData?.stages ?? [];

  return (
    <div className="border-b border-slate-800 bg-slate-950 px-6 py-5">
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-1 text-[11px] text-slate-500">
        <Link to="/catalog" className="hover:text-slate-300 transition-colors">
          Catalog
        </Link>
        {item.kind && (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link
              to={`/catalog?kind=${item.kind}`}
              className="font-mono uppercase hover:text-slate-300 transition-colors"
            >
              {item.kind}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-400">default</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-200">{item.name}</span>
      </div>

      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-slate-100">{item.name}</h1>
          {item.description && (
            <p className="mt-1 text-[13px] text-slate-400 line-clamp-2">{item.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Link
            to={`/inventory?item=${item.id}`}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-[12px] text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Tam Detay
          </Link>
        </div>
      </div>

      {/* Chips row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.kind && (
          <span className="inline-flex items-center rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-400">
            {item.kind}
          </span>
        )}
        {item.owner_ref && (
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
            {item.owner_ref.kind}: {item.owner_ref.name}
          </span>
        )}
      </div>

      {/* Lifecycle rail */}
      {allStages.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {allStages.map((stage) => {
            const active = assignedStageIds.has(stage.id);
            return (
              <span
                key={stage.id}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-slate-800 text-slate-600',
                )}
                title={stage.key}
              >
                {stage.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
