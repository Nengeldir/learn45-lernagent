import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the playable demo as one self-contained page: fonts and images inline, one script.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
