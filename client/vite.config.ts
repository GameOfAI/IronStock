import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 2 ile uyumlu Vite config.
// https://tauri.app/v1/guides/getting-started/setup/vite/
export default defineConfig(async () => ({
  plugins: [react()],

  // Tauri dev server'ı sabit portta ister
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  // Tauri env prefix
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
