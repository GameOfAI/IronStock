import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      // WebSocket endpoint must be declared BEFORE the generic /api rule
      // so Vite applies the ws:true upgrade for /api/v1/ws connections.
      // VITE_PROXY_TARGET allows overriding the target when running inside
      // Docker (use service name instead of localhost).
      '/api/v1/ws': {
        target: process.env.VITE_WS_PROXY_TARGET ?? 'ws://localhost:8080',
        ws: true,
        // rewriteWsOrigin intentionally omitted: browser sends Origin: localhost:5173
        // which matches the server's allowed OriginPatterns (localhost:*).
        // Inside Docker the proxy rewrites to server:8080 if enabled — rejected.
      },
      '/api': process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080',
    },
  },
});
