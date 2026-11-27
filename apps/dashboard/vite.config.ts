import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../cloud/public',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/health': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
      '/p': 'http://127.0.0.1:8787',
      '/api': 'http://127.0.0.1:8787',
      '/soundbox': 'http://127.0.0.1:8787',
      '/qr': 'http://127.0.0.1:8787',
    },
  },
});
