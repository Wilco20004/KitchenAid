import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:8096',
      '/uploads': 'http://localhost:8096',
      '/mcp': 'http://localhost:8096',
    },
  },
  build: {
    outDir: 'dist',
  },
});
