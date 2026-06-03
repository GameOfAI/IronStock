/**
 * EntityPageRegistry — plugin slot context for item detail tabs (PR-DP07).
 *
 * Allows registering additional tabs for specific entity kinds (or all kinds
 * with '*'). ItemDetail renders these alongside its built-in 8 tabs.
 *
 * Usage:
 *   // register a tab for Server kind:
 *   const { registerTab } = useEntityPageRegistry();
 *   registerTab('Server', {
 *     id: 'network-info',
 *     label: 'Ağ Bilgisi',
 *     order: 0, // rendered before built-in tabs
 *     component: NetworkInfoTab,
 *   });
 *
 *   // in ItemDetail, consume extra tabs:
 *   const { getTabsForKind } = useEntityPageRegistry();
 *   const extraTabs = getTabsForKind(item.kind ?? '*');
 */

import * as React from 'react';
import type { Item } from '@/api/types';

export interface EntityTab {
  /** Unique tab identifier (used as TabsTrigger value). */
  id: string;
  label: string;
  icon?: React.ElementType;
  /** When present, tab is only shown if this returns true for the item. */
  condition?: (entity: Item) => boolean;
  component: React.ComponentType<{ entity: Item }>;
  /** Lower numbers render first. Defaults to 50. */
  order?: number;
}

interface EntityPageRegistryContextValue {
  /** Returns all tabs registered for the given kind + wildcard (*) tabs. */
  getTabsForKind: (kind: string) => EntityTab[];
  /** Register a tab for a kind ('*' = all kinds). */
  registerTab: (kind: string, tab: EntityTab) => void;
}

const EntityPageRegistryContext =
  React.createContext<EntityPageRegistryContextValue | null>(null);

export function EntityPageRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Mutable ref so registerTab calls don't trigger re-renders.
  const registryRef = React.useRef<Map<string, EntityTab[]>>(new Map());

  const registerTab = React.useCallback((kind: string, tab: EntityTab) => {
    const existing = registryRef.current.get(kind) ?? [];
    if (!existing.find((t) => t.id === tab.id)) {
      registryRef.current.set(kind, [...existing, tab]);
    }
  }, []);

  const getTabsForKind = React.useCallback((kind: string): EntityTab[] => {
    const wildcard = registryRef.current.get('*') ?? [];
    const kindTabs = kind ? (registryRef.current.get(kind) ?? []) : [];
    const combined = [...wildcard, ...kindTabs];
    return combined.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  }, []);

  const value = React.useMemo(
    () => ({ getTabsForKind, registerTab }),
    [getTabsForKind, registerTab],
  );

  return (
    <EntityPageRegistryContext.Provider value={value}>
      {children}
    </EntityPageRegistryContext.Provider>
  );
}

export function useEntityPageRegistry() {
  const ctx = React.useContext(EntityPageRegistryContext);
  if (!ctx) {
    throw new Error('useEntityPageRegistry must be used inside EntityPageRegistryProvider');
  }
  return ctx;
}
