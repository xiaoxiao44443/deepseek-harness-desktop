import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
        browserWindow: fileURLToPath(new URL('./src/renderer/browser-window.html', import.meta.url)),
        browserMenu: fileURLToPath(new URL('./src/renderer/browser-menu.html', import.meta.url)),
      },
    },
    // Lightning CSS currently drops the unprefixed backdrop-filter declaration
    // for Electron's renderer target. Keep the tiny shell stylesheet verbatim so
    // both standard and WebKit declarations remain available.
    cssMinify: false,
  },
})
