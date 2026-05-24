/**
 * SkipLink — PR-PROD4: Accessibility skip-to-main-content link.
 *
 * Rendered as the first focusable element in the DOM. Keyboard users (and
 * screen readers) can Tab to it and skip past the navigation to reach the
 * main content area directly.
 *
 * The link is visually hidden until focused so it doesn't affect sighted users.
 *
 * WCAG 2.1 Success Criterion 2.4.1 — Bypass Blocks (Level A).
 *
 * Usage: render <SkipLink /> as the very first child of <body> or the root
 * layout component, before any navigation.
 *
 *   <SkipLink />
 *   <AppShell>…</AppShell>
 *
 * The target element must have id="main-content":
 *   <main id="main-content" tabIndex={-1}>…</main>
 */

import * as React from 'react';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={[
        // Visually hidden by default.
        'absolute -top-full left-0 z-[9999]',
        'bg-primary text-primary-foreground',
        'px-4 py-2 text-sm font-medium rounded-br',
        // Visible when focused.
        'focus:top-0',
        // Smooth transition so the link doesn't suddenly pop.
        'transition-[top] duration-100',
      ].join(' ')}
    >
      Ana içeriğe atla
    </a>
  );
}
