import os from 'node:os';

/**
 * Photo hand-off relay for the Vite dev server.
 *
 * A customer on a laptop scans a QR code; their phone opens /capture/<code>,
 * takes the inspection photos live and posts them here; the laptop polls the
 * same session and the tiles fill in. Sessions live in memory for 30 minutes.
 *
 * This is the development implementation. The same four endpoints belong in
 * the production API:
 *   GET  /api/capture/host              → { origin }  address phones can reach
 *   POST /api/capture                   → { code }    body: { plate, shots }
 *   GET  /api/capture/:code             → session
 *   PUT  /api/capture/:code/photos/:key → session     body: { dataUrl }
 *   POST /api/capture/:code/complete    → session
 */
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const sessions = new Map();

const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const lanAddress = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal)?.address || 'localhost';

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const publicSession = (session) => ({
  code: session.code, plate: session.plate, shots: session.shots, status: session.status,
  photos: session.photos, createdAt: session.createdAt, updatedAt: session.updatedAt,
});

const liveSession = (code) => {
  const session = sessions.get(code);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) { sessions.delete(code); return null; }
  return session;
};

export default function captureRelay() {
  return {
    name: 'insurshield-capture-relay',
    configureServer(server) {
      server.middlewares.use('/api/capture', async (req, res) => {
        const url = new URL(req.url, 'http://relay');
        const parts = url.pathname.split('/').filter(Boolean);
        try {
          if (req.method === 'GET' && parts[0] === 'host') {
            const port = server.config.server.port || 5173;
            return send(res, 200, { origin: `${server.config.server.https ? 'https' : 'http'}://${lanAddress()}:${port}` });
          }
          if (req.method === 'POST' && parts.length === 0) {
            const { plate = '', shots = [] } = await readJson(req);
            const code = newCode();
            const session = { code, plate, shots, status: 'open', photos: {}, createdAt: Date.now(), updatedAt: Date.now() };
            sessions.set(code, session);
            return send(res, 201, publicSession(session));
          }
          const session = liveSession(parts[0]);
          if (!session) return send(res, 404, { error: 'This capture link has expired. Generate a new QR code on your computer.' });
          if (req.method === 'GET' && parts.length === 1) return send(res, 200, publicSession(session));
          if (req.method === 'PUT' && parts[1] === 'photos' && parts[2]) {
            const { dataUrl } = await readJson(req);
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return send(res, 400, { error: 'A JPEG data URL is required.' });
            session.photos[parts[2]] = dataUrl;
            session.updatedAt = Date.now();
            return send(res, 200, publicSession(session));
          }
          if (req.method === 'POST' && parts[1] === 'complete') {
            session.status = 'complete';
            session.updatedAt = Date.now();
            return send(res, 200, publicSession(session));
          }
          return send(res, 404, { error: 'Not found' });
        } catch (error) {
          return send(res, error.message === 'Payload too large' ? 413 : 400, { error: error.message });
        }
      });
    },
  };
}
