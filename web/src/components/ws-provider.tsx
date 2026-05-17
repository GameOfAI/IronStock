/**
 * WsProvider — mounts the WebSocket client when the user is authenticated.
 *
 * Renders nothing; side-effect only. Placed inside <AuthGate> so it only
 * runs with a valid accessToken. Destroys the client on logout/unmount.
 *
 * Connection status + error detail is exposed via useWsDetail hook.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { WsClient, WsStatusDetail } from '@/api/ws';

const OFFLINE_DETAIL: WsStatusDetail = { status: 'offline', attempt: 0 };

const WsDetailContext = createContext<WsStatusDetail>(OFFLINE_DETAIL);

// eslint-disable-next-line react-refresh/only-export-components
export function useWsDetail(): WsStatusDetail {
  return useContext(WsDetailContext);
}

// Backwards-compat shim used by existing callers.
// eslint-disable-next-line react-refresh/only-export-components
export function useWsStatus() {
  return useContext(WsDetailContext).status;
}

interface Props {
  children: React.ReactNode;
}

export function WsProvider({ children }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [detail, setDetail] = useState<WsStatusDetail>(OFFLINE_DETAIL);
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!accessToken) {
      clientRef.current?.destroy();
      clientRef.current = null;
      setDetail(OFFLINE_DETAIL);
      return;
    }

    const client = new WsClient();
    clientRef.current = client;
    setDetail(client.getDetail());

    const unsub = client.onStatus((d) => setDetail({ ...d }));
    return () => {
      unsub();
      client.destroy();
      clientRef.current = null;
    };
  }, [accessToken]);

  return <WsDetailContext.Provider value={detail}>{children}</WsDetailContext.Provider>;
}
