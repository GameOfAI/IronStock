import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
// Vitest için ayrı config — @tailwindcss/vite dahil değil.
// Tailwind'in lightningcss bağımlılığı platform-native binary gerektirir;
// CI ortamında (linux) lokal kurulumdan farklı binary gerekebilir.
// PR-S1'de web/vitest.config.ts ayrıştırılırken aynı ders öğrenildi.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        css: false,
    },
});
