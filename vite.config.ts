import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspPlugin } from './build/cspPlugin';

// GitHub Pages serves the site from https://<user>.github.io/samepage/
export default defineConfig({
  base: '/samepage/',
  plugins: [react(), tailwindcss(), cspPlugin()],
  worker: { format: 'es' },
  // MuPDF loads its WASM via new URL(..., import.meta.url); keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ['mupdf'] },
  build: { target: 'es2023' },
});
