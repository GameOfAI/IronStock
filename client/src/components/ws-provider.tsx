import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { WsClient, WsStatus } from '@/api/ws';

const WsStatusContext = createContext<WsStatus>('offline');

// eslint-disable-next-line react-refresh/only-export-components
export function useWsStatus(): WsStatus {
  return useContext(WsStatusContext);
}

interface Props {
  children: React.ReactNode;
}

export function WsProvider({ children }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [wsStatus, setWsStatus] = useState<WsStatus>('offline');
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!accessToken) {
      clientRef.current?.destroy();
      clientRef.current = null;
      setWsStatus('offline');
      return;
    }

    const client = new WsClient(accessToken);
    clientRef.current = client;
    setWsStatus(client.getStatus());

    const unsub = client.onStatus((s) => setWsStatus(s));
    return () => {
      unsub();
      client.destroy();
      clientRef.current = null;
    };
  }, [accessToken]);

  return <WsStatusContext.Provider value={wsStatus}>{children}</WsStatusContext.Provider>;
}
