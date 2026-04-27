/**
 * ConnectionGate — sunucu URL'i ayarlanmamışsa /config'e yönlendirir.
 *
 * Web admin UI'da sunucu her zaman aynı origin'de olduğu için böyle bir
 * gate yoktu. Desktop client farklı sunuculara bağlanabildiğinden
 * kullanıcı ilk çalıştırmada adres girmeli.
 *
 * Sıra: ConnectionGate → AuthGate → AppShell (iç içe route'lar).
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useConnectionStore } from '@/store/connection';

export function ConnectionGate() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  if (!serverUrl) return <Navigate to="/config" replace />;
  return <Outlet />;
}
