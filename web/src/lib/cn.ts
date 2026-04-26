import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind-aware class name merger. Used by every shadcn/ui component.
 *
 * `clsx` handles arrays / objects / falsy values, `tailwind-merge` resolves
 * conflicts between Tailwind utilities (later one wins, e.g.
 * `cn('p-2', 'p-4')` -> `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
