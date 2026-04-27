/**
 * InventoryPage — placeholder.
 * İçerik PR-C4'te (client-inventory-read) doldurulacak.
 */

import { Folder } from 'lucide-react';

export default function InventoryPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Folder className="h-10 w-10" />
        <p className="text-sm">Envanter görünümü — PR-C4 (client-inventory-read) ile gelecek.</p>
      </div>
    </div>
  );
}
