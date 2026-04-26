/**
 * ThemeProvider — applies the user's theme preference to <html>.
 *
 * Reads `theme` from useUIStore. 'system' resolves to the OS preference
 * via prefers-color-scheme media query (re-evaluates on change).
 *
 * Adds/removes the `dark` class on <html> so Tailwind's dark variant
 * (configured via the .dark CSS class in index.css) toggles correctly.
 */

import * as React from 'react';
import { useUIStore } from '@/store/ui';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((s) => s.theme);

  React.useEffect(() => {
    const root = document.documentElement;
    const apply = (resolved: 'light' | 'dark') => {
      root.classList.toggle('dark', resolved === 'dark');
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches ? 'dark' : 'light');
      const onChange = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    apply(theme);
    return undefined;
  }, [theme]);

  return <>{children}</>;
}
