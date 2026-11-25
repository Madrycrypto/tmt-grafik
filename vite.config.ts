/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// base './' + HashRouter: działa pod dowolną nazwą repozytorium na GitHub Pages
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'push-sw.js'],
      workbox: {
        importScripts: ['push-sw.js'],
        navigateFallbackDenylist: [/^\/functions\//],
      },
      manifest: {
        name: 'TMT Grafik — brygady i obsada',
        short_name: 'TMT Grafik',
        description: 'Grafik 4 brygad, matryca kompetencji i zastępstwa na liniach produkcyjnych',
        lang: 'pl',
        theme_color: '#1B2230',
        background_color: '#F3F4F7',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
