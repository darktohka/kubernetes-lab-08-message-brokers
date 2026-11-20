import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const service = (port: number) => ({
  target: `http://localhost:${port}`,
  changeOrigin: true,
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api/drones': service(3001),
      '/api/locations': service(3002),
      '/api/scheduling': service(3003),
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    target: 'es2022',
    cssTarget: 'chrome110',
  },
});
