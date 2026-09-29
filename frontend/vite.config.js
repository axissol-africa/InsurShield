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
  server: {
    // Listen on the LAN so a phone can open the capture link shown in the QR code.
    host: true,
    proxy: {
      // The API runs on its own port in development. Proxying keeps the
      // browser on a single origin, so the default `/api/v1` base URL works
      // and there is no CORS round trip.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    // The suite exercises the app's own logic, so it runs against the mock
    // adapter whatever a developer has in .env.local. A case that needs the
    // other mode stubs it itself.
    env: { VITE_API_MODE: 'mock' },
    include: ['src/**/*.{test,spec}.{js,jsx}', 'tools/**/*.test.js'],
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
