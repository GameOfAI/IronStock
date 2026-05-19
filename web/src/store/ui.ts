/**
 * UI store — non-secret, persistable client state.
 *
 *   theme           : 'light' | 'dark' | 'system' — persisted to localStorage
 *   sidebarCollapsed : sidebar open/closed (persisted)
 *
 * Theme application is in components/layout/ThemeProvider; this store only
 * holds the user's preference.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  setTheme(theme: Theme): void;
  toggleSidebar(): void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      setTheme(theme) {
        set({ theme });
      },
      toggleSidebar() {
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
      },
    }),
    {
      name: 'envanter-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
