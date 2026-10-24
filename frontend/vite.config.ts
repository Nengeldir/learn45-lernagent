import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.API_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Lernagent für Learn45 (Prototyp)',
        short_name: 'Lernagent',
        description: 'Prototyp: Login mit DCC-Profil, Lernkarte als Mindmap, begründete nächste Schritte.',
        lang: 'de-CH',
        start_url: '/',
        display: 'standalone',
        background_color: '#F7F5F4',
        theme_color: '#DA291C',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            // Content (lessons, personas) for offline use; sessions always go to the network.
            urlPattern: ({ url }) => url.pathname === '/api/content',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'content' },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
});
