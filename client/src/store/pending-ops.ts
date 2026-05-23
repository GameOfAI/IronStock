/**
 * Pending Ops Store — çevrimdışı kuyruk durumu için reaktif Zustand store.
 *
 * Bu store yalnızca UI için (badge count, kuyruk listesi) kullanılır.
 * Disk I/O işlemleri client/src/lib/pending-ops.ts'te yapılır.
 * Sync engine (offline-sync.ts) her değişiklikte bu store'u günceller.
 */

import { create } from 'zustand';
import type { PendingOp } from '@/lib/pending-ops';

interface PendingOpsState {
  ops: PendingOp[];
  /** Ops kuyruğu yüklendi mi? (ilk mount'ta false) */
  hydrated: boolean;

  setOps(ops: PendingOp[]): void;
  addOp(op: PendingOp): void;
  removeOp(id: string): void;
  updateOp(op: PendingOp): void;
  setHydrated(hydrated: boolean): void;
}

export const usePendingOpsStore = create<PendingOpsState>()((set) => ({
  ops: [],
  hydrated: false,

  setOps(ops) {
    set({ ops });
  },

  addOp(op) {
    set((s) => ({ ops: [...s.ops, op] }));
  },

  removeOp(id) {
    set((s) => ({ ops: s.ops.filter((o) => o.id !== id) }));
  },

  updateOp(op) {
    set((s) => ({ ops: s.ops.map((o) => (o.id === op.id ? op : o)) }));
  },

  setHydrated(hydrated) {
    set({ hydrated });
  },
}));
