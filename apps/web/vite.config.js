import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import captureRelay from './tools/capture-relay.js'

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

function serviceWorkerBuild(apiBaseUrl) {
  let config

  return {
    name: 'insurshield-service-worker-build',
    apply: 'build',
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    // Vite 8 may call closeBundle before the output directory has been
    // written on a clean build. The worker manifest depends on emitted asset
    // filenames, so it belongs in writeBundle, which runs after output.
    async writeBundle() {
      const outputDirectory = path.resolve(config.root, config.build.outDir)
      const templatePath = path.join(config.publicDir, 'sw.js')
      const workerPath = path.join(outputDirectory, 'sw.js')
      const assetsDirectory = path.join(outputDirectory, 'assets')
      const assetPaths = await listFiles(assetsDirectory)
      const shellAssets = [
        '/index.html',
        '/fonts/material-symbols-subset.woff2',
        ...assetPaths.map(assetPath => `/${path.relative(outputDirectory, assetPath).split(path.sep).join('/')}`),
      ]
      const template = await readFile(templatePath, 'utf8')
      const worker = template
        .replace('__INSURSHIELD_BUILD_ID__', randomUUID())
        .replace('__INSURSHIELD_SHELL_ASSETS__', JSON.stringify(shellAssets))
        .replace('__INSURSHIELD_API_BASE_URL__', apiBaseUrl)

      await writeFile(workerPath, worker)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      captureRelay({ publicOrigin: env.CAPTURE_PUBLIC_ORIGIN }),
      serviceWorkerBuild(env.VITE_API_BASE_URL || '/api/v1'),
    ],
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
      // Interaction tests mount the whole journey and use realistic keyboard
      // events. One worker keeps the suite deterministic on shared developer
      // machines and modest CI runners instead of letting parallel jsdom work
      // turn valid interactions into five-second timeouts.
      maxWorkers: 1,
      css: false,
    },
  }
})
