/**
 * Admin placeholder — Mac doldurur (PR-W3 admin user mgmt + audit log).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminUsersPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kullanıcı Yönetimi</CardTitle>
        <CardDescription>PR-W3 (Mac) — user list + role assign + disable/enable</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Mac sahası: <code>web/src/pages/admin/**</code>. Mac branch:{' '}
          <code>feat/web-admin</code>.
        </p>
      </CardContent>
    </Card>
  );
}

export function AdminAuditLogPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>PR-W3 (Mac) — filter + pagination + JSON details</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Backend hazır: <code>GET /api/v1/admin/audit-log</code>.
        </p>
      </CardContent>
    </Card>
  );
}
