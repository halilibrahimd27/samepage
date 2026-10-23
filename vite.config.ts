import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves the site from https://<user>.github.io/samepage/
export default defineConfig({
  base: '/samepage/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2023' },
});
