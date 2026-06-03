/**
 * default-entity-tabs — built-in tab IDs + kind-specific overview registrations (PR-DP07/08).
 *
 * DefaultTabsRegistrar must be rendered inside EntityPageRegistryProvider (done in App.tsx).
 */

import * as React from 'react';
import { useEntityPageRegistry } from '@/lib/entity-page-registry';
import { ServerOverviewTab } from '@/components/catalog/kind-overviews/server-overview';
import { DatabaseOverviewTab } from '@/components/catalog/kind-overviews/database-overview';
import { ServiceOverviewTab } from '@/components/catalog/kind-overviews/service-overview';
import { CertificateOverviewTab } from '@/components/catalog/kind-overviews/certificate-overview';
import { AnnotationsPanel } from '@/components/inventory/annotations-panel';

/** Tab IDs already rendered by ItemDetail — do not re-register via EntityPageRegistry. */
export const BUILTIN_TAB_IDS = [
  'genel',
  'alanlar',
  'iliskiler',
  'baglanti',
  'yasam',
  'gecmis',
  'saglik',
  'ai-oneriler',
] as const;

export type BuiltinTabId = (typeof BUILTIN_TAB_IDS)[number];

/**
 * Renders nothing; registers kind-specific overview tabs once on mount.
 * Render this inside EntityPageRegistryProvider (App.tsx does this).
 */
export function DefaultTabsRegistrar() {
  const { registerTab } = useEntityPageRegistry();

  React.useEffect(() => {
    registerTab('Server', {
      id: 'server-overview',
      label: 'Genel Bakış',
      order: 0,
      component: ServerOverviewTab,
    });
    registerTab('Database', {
      id: 'database-overview',
      label: 'Genel Bakış',
      order: 0,
      component: DatabaseOverviewTab,
    });
    registerTab('Service', {
      id: 'service-overview',
      label: 'Genel Bakış',
      order: 0,
      component: ServiceOverviewTab,
    });
    registerTab('Certificate', {
      id: 'certificate-overview',
      label: 'Genel Bakış',
      order: 0,
      component: CertificateOverviewTab,
    });
    registerTab('*', {
      id: 'annotations',
      label: 'Açıklamalar',
      order: 25,
      component: AnnotationsPanel,
    });
  }, [registerTab]);

  return null;
}
