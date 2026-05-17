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
      '/api/v1/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        rewriteWsOrigin: true,
      },
      '/api': 'http://localhost:8080',
    },
  },
});
