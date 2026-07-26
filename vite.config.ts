import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split only the always-needed, rarely-changing libraries into their own
        // cached chunks so app-code redeploys don't re-download them. Named-package
        // form on purpose: the heavy PDF/Excel deps (xlsx, jspdf, html2pdf, jszip)
        // are dynamically imported and must stay in their own lazy chunks — do NOT
        // add a generic node_modules->vendor rule that would pull them into the
        // initial bundle.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  // Honor a harness-assigned PORT (multi-session dev servers); defaults to 5173.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
});
