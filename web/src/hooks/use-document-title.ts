/**
 * useDocumentTitle — PR-PROD4: Sets the browser tab title for a route.
 *
 * Appends the site name ("IronStock") to every page title so users can tell
 * tabs apart. Screen readers also announce the page title on navigation, which
 * helps orientation for blind users.
 *
 * WCAG 2.1 Success Criterion 2.4.2 — Page Titled (Level A).
 *
 * Usage:
 *   useDocumentTitle('Envanter');        // → "Envanter — IronStock"
 *   useDocumentTitle('Admin / Kullanıcılar'); // → "Admin / Kullanıcılar — IronStock"
 *   useDocumentTitle(null);              // → "IronStock" (default, e.g. on login)
 */

import { useEffect } from 'react';

const SITE_NAME = 'IronStock';

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
