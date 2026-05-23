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
import { setBaseUrl, setTlsSkipVerify, setClientCert, setOfflineModeEnabled } from '@/api/client';
import { setContentProtection } from '@/lib/tauri';

interface ConnectionState {
  serverUrl: string;
  tlsSkipVerify: boolean;
  /** Base64-encoded PKCS12 (.p12) içeriği — mTLS için. Boş string = cert yok. */
  clientCertP12Base64: string;
  /** PKCS12 açma parolası — localStorage'da tutulur (operasyonel kolaylık için). */
  clientCertPassword: string;
  /**
   * Offline mod aktifse, ağ bağlantısı yokken yapılan mutation'lar kuyruğa alınır
   * ve bağlantı geri gelince otomatik tekrar denenir.
   */
  offlineModeEnabled: boolean;
  /**
   * Ekran yakalama koruması — true iken uygulama penceresi ekran paylaşımı/kaydında
   * gizlenir. Varsayılan: true (güvenli mod). Kullanıcı devre dışı bırakabilir.
   */
  contentProtectionEnabled: boolean;
  setConnection(serverUrl: string, tlsSkipVerify?: boolean): void;
  setClientCert(p12Base64: string, password: string): void;
  clearClientCert(): void;
  setOfflineMode(enabled: boolean): void;
  setContentProtection(enabled: boolean): void;
  clearConnection(): void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      serverUrl: '',
      tlsSkipVerify: false,
      clientCertP12Base64: '',
      clientCertPassword: '',
      offlineModeEnabled: false,
      contentProtectionEnabled: true,

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

      setOfflineMode(enabled) {
        setOfflineModeEnabled(enabled);
        set({ offlineModeEnabled: enabled });
      },

      setContentProtection(enabled) {
        void setContentProtection(enabled);
        set({ contentProtectionEnabled: enabled });
      },

      clearConnection() {
        setBaseUrl('');
        setTlsSkipVerify(false);
        setClientCert('', '');
        setOfflineModeEnabled(false);
        set({ serverUrl: '', tlsSkipVerify: false, clientCertP12Base64: '', clientCertPassword: '', offlineModeEnabled: false });
      },
    }),
    {
      name: 'envanter-client-connection',
      partialize: (s) => ({
        serverUrl: s.serverUrl,
        tlsSkipVerify: s.tlsSkipVerify,
        clientCertP12Base64: s.clientCertP12Base64,
        clientCertPassword: s.clientCertPassword,
        offlineModeEnabled: s.offlineModeEnabled,
        contentProtectionEnabled: s.contentProtectionEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        // Hydration sonrası api/client module değişkenlerini güncelle.
        if (state?.serverUrl) setBaseUrl(state.serverUrl);
        if (state?.tlsSkipVerify) setTlsSkipVerify(state.tlsSkipVerify);
        if (state?.clientCertP12Base64) setClientCert(state.clientCertP12Base64, state.clientCertPassword ?? '');
        if (state?.offlineModeEnabled) setOfflineModeEnabled(state.offlineModeEnabled);
        // contentProtectionEnabled: undefined (yeni kurulum) → true olarak bırak (Rust setup zaten true yaptı).
        // Sadece kullanıcı explicit false yaptıysa override et.
        if (state?.contentProtectionEnabled === false) {
          void setContentProtection(false);
        }
      },
    },
  ),
);
