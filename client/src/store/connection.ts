/**
 * Connection store — sunucu bağlantı ayarları.
 *
 * Web admin UI'ın aksine desktop client farklı sunuculara bağlanabilir.
 * Kullanıcı ilk çalıştırmada /config ekranında URL girer; persist edilir.
 *
 * serverUrl : "https://envanter.sirket.com" (trailing slash yok)
 * tlsSkipVerify : true = geliştirme ortamında self-signed cert kabul et
 *
 * setBaseUrl(serverUrl) çağrısı api/client.ts'deki module-level değişkeni
 * de günceller — App.tsx mount'ta ve ConfigPage kaydetme sonrasında çağrılır.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setBaseUrl, setTlsSkipVerify } from '@/api/client';

interface ConnectionState {
  serverUrl: string;
  tlsSkipVerify: boolean;
  setConnection(serverUrl: string, tlsSkipVerify?: boolean): void;
  clearConnection(): void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      serverUrl: '',
      tlsSkipVerify: false,

      setConnection(serverUrl, tlsSkipVerify = false) {
        const url = serverUrl.replace(/\/$/, '');
        setBaseUrl(url);
        setTlsSkipVerify(tlsSkipVerify);
        set({ serverUrl: url, tlsSkipVerify });
      },

      clearConnection() {
        setBaseUrl('');
        setTlsSkipVerify(false);
        set({ serverUrl: '', tlsSkipVerify: false });
      },
    }),
    {
      name: 'envanter-client-connection',
      partialize: (s) => ({ serverUrl: s.serverUrl, tlsSkipVerify: s.tlsSkipVerify }),
      onRehydrateStorage: () => (state) => {
        // Hydration sonrası api/client'ı güncelle.
        if (state?.serverUrl) setBaseUrl(state.serverUrl);
        if (state?.tlsSkipVerify) setTlsSkipVerify(state.tlsSkipVerify);
      },
    },
  ),
);
