import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import captureRelay from './capture-relay.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), captureRelay()],
  // Listen on the LAN so a phone can open the capture link shown in the QR code.
  server: { host: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}', 'capture-relay.test.js'],
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
