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
import { setBaseUrl, setTlsSkipVerify, setClientCert } from '@/api/client';

interface ConnectionState {
  serverUrl: string;
  tlsSkipVerify: boolean;
  /** Base64-encoded PKCS12 (.p12) içeriği — mTLS için. Boş string = cert yok. */
  clientCertP12Base64: string;
  /** PKCS12 açma parolası — localStorage'da tutulur (operasyonel kolaylık için). */
  clientCertPassword: string;
  setConnection(serverUrl: string, tlsSkipVerify?: boolean): void;
  setClientCert(p12Base64: string, password: string): void;
  clearClientCert(): void;
  clearConnection(): void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      serverUrl: '',
      tlsSkipVerify: false,
      clientCertP12Base64: '',
      clientCertPassword: '',

      setConnection(serverUrl, tlsSkipVerify = false) {
        const url = serverUrl.replace(/\/$/, '');
        setBaseUrl(url);
        setTlsSkipVerify(tlsSkipVerify);
        set({ serverUrl: url, tlsSkipVerify });
      },

      setClientCert(p12Base64, password) {
        setClientCert(p12Base64, password);
        set({ clientCertP12Base64: p12Base64, clientCertPassword: password });
      },

      clearClientCert() {
        setClientCert('', '');
        set({ clientCertP12Base64: '', clientCertPassword: '' });
      },

      clearConnection() {
        setBaseUrl('');
        setTlsSkipVerify(false);
        setClientCert('', '');
        set({ serverUrl: '', tlsSkipVerify: false, clientCertP12Base64: '', clientCertPassword: '' });
      },
    }),
    {
      name: 'envanter-client-connection',
      partialize: (s) => ({
        serverUrl: s.serverUrl,
        tlsSkipVerify: s.tlsSkipVerify,
        clientCertP12Base64: s.clientCertP12Base64,
        clientCertPassword: s.clientCertPassword,
      }),
      onRehydrateStorage: () => (state) => {
        // Hydration sonrası api/client module değişkenlerini güncelle.
        if (state?.serverUrl) setBaseUrl(state.serverUrl);
        if (state?.tlsSkipVerify) setTlsSkipVerify(state.tlsSkipVerify);
        if (state?.clientCertP12Base64) setClientCert(state.clientCertP12Base64, state.clientCertPassword ?? '');
      },
    },
  ),
);
