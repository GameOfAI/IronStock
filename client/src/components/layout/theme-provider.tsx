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
