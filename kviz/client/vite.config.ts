import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/kviz/',
  server: {
    proxy: {
      '/kviz/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
