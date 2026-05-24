/**
 * EmptyState — PR-PROD4: Reusable empty-state component.
 *
 * Used when a list, table, or panel has no content. Provides a consistent
 * visual pattern across all pages: icon + heading + description + optional CTA.
 *
 * Usage:
 *   <EmptyState
 *     icon={FolderOpen}
 *     title="Klasör yok"
 *     description="Başlamak için ilk klasörünüzü oluşturun."
 *     action={{ label: 'Klasör Oluştur', onClick: () => setOpen(true) }}
 *   />
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** Optional: show a secondary action alongside the primary. */
  secondary?: {
    label: string;
    onClick: () => void;
  };
}

export interface EmptyStateProps {
  /** Lucide icon component to display above the title. */
  icon?: LucideIcon;
  /** Short title (h3). */
  title: string;
  /** Longer description / guidance text. */
  description?: string;
  /** Primary CTA button. */
  action?: EmptyStateAction;
  /** Additional CSS classes on the outer wrapper. */
  className?: string;
  /** Size variant: 'sm' for dense lists, 'default' for full-page panels. */
  size?: 'sm' | 'default';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = 'default',
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-label={title}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'default' ? 'py-16 px-6' : 'py-8 px-4',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'rounded-full bg-muted flex items-center justify-center mb-4',
            size === 'default' ? 'h-14 w-14' : 'h-10 w-10',
          )}
          aria-hidden="true"
        >
          <Icon
            className={cn(
              'text-muted-foreground',
              size === 'default' ? 'h-7 w-7' : 'h-5 w-5',
            )}
          />
        </div>
      )}

      <h3
        className={cn(
          'font-semibold text-foreground',
          size === 'default' ? 'text-base' : 'text-sm',
        )}
      >
        {title}
      </h3>

      {description && (
        <p
          className={cn(
            'text-muted-foreground mt-1 max-w-sm',
            size === 'default' ? 'text-sm' : 'text-xs',
          )}
        >
          {description}
        </p>
      )}

      {action && (
        <div className="mt-4 flex items-center gap-2">
          <Button size={size === 'sm' ? 'sm' : 'default'} onClick={action.onClick}>
            {action.label}
          </Button>
          {action.secondary && (
            <Button
              size={size === 'sm' ? 'sm' : 'default'}
              variant="outline"
              onClick={action.secondary.onClick}
            >
              {action.secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
