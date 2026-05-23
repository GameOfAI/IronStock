/**
 * useOfflineSync — çevrimiçi olunca pending op'ları otomatik senkronize eder.
 *
 * - Mount'ta disk'teki kuyruğu yükler, store'u hydrate eder.
 * - `window.online` event'i gelince syncPendingOps() çağırır.
 * - Kalıcı hata event'ini (offline-sync:discarded) dinleyerek toast gösterir.
 * - `syncNow()` ile manuel tetikleme imkânı sunar.
 */

import * as React from 'react';
import { loadPendingOps } from '@/lib/pending-ops';
import { syncPendingOps } from '@/lib/offline-sync';
import { usePendingOpsStore } from '@/store/pending-ops';
import { useConnectionStore } from '@/store/connection';
import { useToast } from '@/hooks/use-toast';
import type { PendingOp } from '@/lib/pending-ops';

export function useOfflineSync() {
  const { toast } = useToast();
  const setOps = usePendingOpsStore((s) => s.setOps);
  const setHydrated = usePendingOpsStore((s) => s.setHydrated);
  const offlineModeEnabled = useConnectionStore((s) => s.offlineModeEnabled);

  // Mount'ta disk'ten kuyruğu yükle.
  React.useEffect(() => {
    if (!offlineModeEnabled) {
      setHydrated(true);
      return;
    }

    loadPendingOps().then((ops) => {
      setOps(ops);
      setHydrated(true);
    });
  }, [offlineModeEnabled, setOps, setHydrated]);

  // Çevrimiçi olunca kuyruğu senkronize et.
  React.useEffect(() => {
    if (!offlineModeEnabled) return;

    const handleOnline = () => {
      void syncPendingOps().then((result) => {
        if (result.replayed > 0) {
          toast({
            title: 'Çevrimdışı değişiklikler senkronize edildi',
            description: `${result.replayed} işlem başarıyla sunucuya gönderildi.`,
          });
        }
        if (result.discarded > 0) {
          toast({
            title: 'Bazı işlemler gönderilemedi',
            description: `${result.discarded} işlem maksimum deneme sayısını aştı ve iptal edildi.`,
            variant: 'destructive',
          });
        }
      });
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [offlineModeEnabled, toast]);

  // Kalıcı hata event'i (offline-sync:discarded) — tek op için ayrıntılı toast.
  React.useEffect(() => {
    if (!offlineModeEnabled) return;

    const handleDiscarded = (e: Event) => {
      const op = (e as CustomEvent<{ op: PendingOp }>).detail.op;
      toast({
        title: 'İşlem gönderilemedi',
        description: `"${op.method} ${op.path}" isteği ${op.retryCount} denemeden sonra iptal edildi.`,
        variant: 'destructive',
      });
    };

    window.addEventListener('offline-sync:discarded', handleDiscarded);
    return () => window.removeEventListener('offline-sync:discarded', handleDiscarded);
  }, [offlineModeEnabled, toast]);

  return {
    syncNow: () => syncPendingOps(),
  };
}
