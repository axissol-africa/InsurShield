import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const distRoot = path.join(webRoot, 'dist');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

function cleanPathname(pathname) {
  const relativePath = path.posix.normalize(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(distRoot, relativePath || 'index.html');

  if (!filePath.startsWith(`${distRoot}${path.sep}`) && filePath !== path.join(distRoot, 'index.html')) {
    return null;
  }

  return filePath;
}

async function readStaticFile(pathname) {
  const filePath = cleanPathname(pathname);
  if (!filePath) return null;

  try {
    return { body: await readFile(filePath), filePath };
  } catch {
    if (path.extname(pathname)) return null;
    return { body: await readFile(path.join(distRoot, 'index.html')), filePath: path.join(distRoot, 'index.html') };
  }
}

function setResponse(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

export async function startProductionServer() {
  const apiRequests = [];
  let probeReads = 0;

  const server = http.createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url, origin);

    if (url.pathname === '/worker-test') {
      setResponse(response, 200, `<!doctype html><meta charset="utf-8"><title>Worker test</title><script>navigator.serviceWorker.register('/sw.js')</script><main id="worker-test">Worker test</main>`, 'text/html; charset=utf-8');
      return;
    }

    if (url.pathname.startsWith('/api/v1')) {
      apiRequests.push(url.pathname + url.search);

      if (url.pathname === '/api/v1/navigate') {
        setResponse(response, 200, `API navigation ${url.searchParams.get('id') ?? ''}`, 'text/html; charset=utf-8');
        return;
      }

      if (url.pathname === '/api/v1/probe') probeReads += 1;
      setResponse(response, 200, JSON.stringify({ request: probeReads }), 'application/json; charset=utf-8');
      return;
    }

    const file = await readStaticFile(url.pathname);
    if (!file) {
      setResponse(response, 404, 'Not found');
      return;
    }

    const headers = {
      'content-type': contentTypes.get(path.extname(file.filePath)) ?? 'application/octet-stream',
      'cache-control': url.pathname === '/sw.js' ? 'no-store' : 'public, max-age=0',
    };
    response.writeHead(200, headers);
    response.end(file.body);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    apiRequests,
    origin,
    async build(label, apiBaseUrl = `${origin}/api/v1`) {
      const previousMode = process.env.VITE_API_MODE;
      const previousApiBaseUrl = process.env.VITE_API_BASE_URL;
      process.env.VITE_API_MODE = 'http';
      process.env.VITE_API_BASE_URL = apiBaseUrl;

      try {
        await build({ root: webRoot, mode: 'production', logLevel: 'error' });
      } finally {
        if (previousMode === undefined) delete process.env.VITE_API_MODE;
        else process.env.VITE_API_MODE = previousMode;
        if (previousApiBaseUrl === undefined) delete process.env.VITE_API_BASE_URL;
        else process.env.VITE_API_BASE_URL = previousApiBaseUrl;
      }

      const indexPath = path.join(distRoot, 'index.html');
      const index = await readFile(indexPath, 'utf8');
      await writeFile(
        indexPath,
        index.replace('</head>', `<meta name="service-worker-build" content="${label}"></head>`),
      );

      const serviceWorker = await readFile(path.join(distRoot, 'sw.js'), 'utf8');
      const buildId = serviceWorker.match(/const BUILD_ID = ['"]([^'"]+)['"];/)?.[1];
      if (!buildId) throw new Error('The production service worker did not include a build id.');
      return { buildId, label };
    },
    resetApiRequests() {
      apiRequests.length = 0;
      probeReads = 0;
    },
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
