/**
 * Inventory placeholder — Mac doldurur (PR-W4 read + PR-W5 write).
 *
 * Mevcut iskelet sadece "foundation çalışıyor" görseli; Mac PR-W4'te
 * folder tree + item list + detail panel layout'u buraya gelir.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function InventoryPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Envanter</CardTitle>
        <CardDescription>PR-W4 (Mac) — folder tree + item list + detail panel</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Mac sahası: <code>web/src/pages/inventory/**</code>. Mac branch'leri:
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
          <li>
            <code>feat/web-inventory-read</code> — folder tree, item list, detail panel
          </li>
          <li>
            <code>feat/web-inventory-write</code> — create/edit/delete + paylaşım modal
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
