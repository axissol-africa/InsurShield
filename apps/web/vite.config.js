import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import captureRelay from './tools/capture-relay.js'
import { assertReleaseApi } from './tools/release-build.js'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)

const PUBLIC_PAGE_CHUNKS = new Map([
  ['LandingPage', '/'],
  ['InsuranceTypePage', '/insurance-type'],
  ['SupportPage', '/support'],
])

async function writePublicPagePreloads(outputDirectory, bundle) {
  const routes = {}
  function importsFor(chunk, files = new Set()) {
    if (chunk?.type !== 'chunk' || files.has(chunk.fileName)) return files
    files.add(chunk.fileName)
    for (const dependency of chunk.imports) importsFor(bundle[dependency], files)
    return files
  }
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk' || !PUBLIC_PAGE_CHUNKS.has(chunk.name)) continue
    routes[PUBLIC_PAGE_CHUNKS.get(chunk.name)] = [...importsFor(chunk)].map(file => `/${file}`)
  }
  if (!Object.keys(routes).length) return

  // Only fetch the public page named by the URL, before the application entry
  // has loaded. Application code still owns rendering and the identity gate.
  const source = `(() => {
    const routes = ${JSON.stringify(routes)};
    const path = location.pathname.replace(/\\/+$/, '') || '/';
    const alreadyPreloaded = new Set([...document.querySelectorAll('link[rel=modulepreload]')]
      .map(link => link.getAttribute('href')));
    for (const href of (Object.hasOwn(routes, path) ? routes[path] : [])) {
      if (alreadyPreloaded.has(href)) continue;
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.crossOrigin = 'anonymous';
      link.href = href;
      document.head.append(link);
    }
  })();`
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
  const filename = `assets/public-page-preloads-${hash}.js`
  const index = path.join(outputDirectory, 'index.html')
  const html = await readFile(index, 'utf8')
  await Promise.all([
    writeFile(path.join(outputDirectory, filename), source),
    writeFile(index, html.replace('</title>', `</title>\n    <script async fetchpriority="high" src="/${filename}"></script>`)),
  ])
}

async function writeCompressedVariants(file) {
  const bytes = await readFile(file)
  const [br, gz] = await Promise.all([
    compressBrotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    compressGzip(bytes, { level: 9 }),
  ])
  await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gz)])
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

function serviceWorkerBuild(apiBaseUrl, compressRelease) {
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
    async writeBundle(_options, bundle) {
      const outputDirectory = path.resolve(config.root, config.build.outDir)
      const templatePath = path.join(config.publicDir, 'sw.js')
      const workerPath = path.join(outputDirectory, 'sw.js')
      const assetsDirectory = path.join(outputDirectory, 'assets')
      if (compressRelease) await writePublicPagePreloads(outputDirectory, bundle)
      const assetPaths = (await listFiles(assetsDirectory)).filter(asset => !/\.(?:br|gz)$/.test(asset))
      const shellAssets = [
        '/index.html',
        '/fonts/material-symbols-subset.woff2',
        ...assetPaths.map(assetPath => `/${path.relative(outputDirectory, assetPath).split(path.sep).join('/')}`),
      ]
      const template = await readFile(templatePath, 'utf8')
      const worker = template
        .replace('__INSURSHIELD_BUILD_ID__', randomUUID())
        .replace('__INSURSHIELD_SHELL_ASSETS__', JSON.stringify(shellAssets))
        .replace("'__INSURSHIELD_API_BASE_URL__'", () => JSON.stringify(apiBaseUrl))

      await writeFile(workerPath, worker)
      if (compressRelease) {
        const compressible = assetPaths.filter(asset => /\.(?:js|css)$/.test(asset))
        const index = path.join(outputDirectory, 'index.html')
        await Promise.all([index, workerPath, ...compressible].map(writeCompressedVariants))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build' && mode === 'release') assertReleaseApi(env)
  const adapter = env.VITE_API_MODE === 'http' ? 'http' : 'mock'

  return {
    plugins: [
      react(),
      tailwindcss(),
      captureRelay({ publicOrigin: env.CAPTURE_PUBLIC_ORIGIN }),
      serviceWorkerBuild(env.VITE_API_BASE_URL || '/api/v1', mode === 'release'),
    ],
    resolve: {
      // `@/` points at src/ so features import each other by stable absolute paths.
      alias: [
        // Use the selected adapter directly in compiled builds so the other
        // adapter's imports never reach the entry bundle.
        ...(command === 'build' ? [{
          find: /^@\/api\/adapter$/,
          replacement: fileURLToPath(new URL(`./src/api/${adapter}/adapter.js`, import.meta.url)),
        }] : []),
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
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
