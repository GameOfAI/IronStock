/**
 * Admin sayfaları için barrel re-export.
 *
 * App.tsx route ağacı şunu bekler:
 *   import AdminUsersPage, { AdminAuditLogPage } from '@/pages/admin';
 */

// Barrel re-export — App.tsx route ağacı bu dosyadan üç page'i de
// alır. Fast-refresh uyarısı barrel pattern'inde anlamsız.
/* eslint-disable react-refresh/only-export-components */
export { default } from './users';
export { AdminAuditLogPage } from './audit-log';
export { default as AdminDashboardPage } from './dashboard';
