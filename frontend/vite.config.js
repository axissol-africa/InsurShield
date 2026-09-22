import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import captureRelay from './tools/capture-relay.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), captureRelay()],
  resolve: {
    // `@/` points at src/ so features import each other by stable absolute paths.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Listen on the LAN so a phone can open the capture link shown in the QR code.
  server: { host: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}', 'tools/**/*.test.js'],
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
