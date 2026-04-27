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
      theme: 'system',
      sidebarCollapsed: false,
      setTheme(theme) {
        set({ theme });
      },
      toggleSidebar() {
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
      },
    }),
    {
      name: 'envanter-client-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
