import os from 'node:os';

/**
 * Photo hand-off relay for the Vite dev server.
 *
 * A customer on a laptop scans a QR code; their phone opens /capture/<code>,
 * takes the inspection photos live and posts them here; the laptop is holding
 * an event stream open and each photo lands on it the moment it arrives.
 * Sessions live in memory for 30 minutes.
 *
 * The session code is the only authorisation: the phone never signs in, which
 * is the point — the customer is already standing at the vehicle.
 *
 * This is the development implementation. The same endpoints belong in the
 * production API:
 *   GET  /api/capture/host              → { origin }  address phones can reach
 *   POST /api/capture                   → { code }    body: { plate, shots }
 *   GET  /api/capture/:code             → session
 *   GET  /api/capture/:code/events      → SSE stream of session/photo/complete
 *   PUT  /api/capture/:code/photos/:key → session     body: { dataUrl }
 *   POST /api/capture/:code/complete    → session
 */
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
/** Proxies drop an idle connection; a comment frame keeps the stream open. */
const HEARTBEAT_MS = 25 * 1000;

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

/** Push one event to every laptop watching this session. */
const broadcast = (session, event) => {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of session.clients) {
    try {
      client.write(frame);
    } catch {
      session.clients.delete(client);
    }
  }
};

const liveSession = (code) => {
  const session = sessions.get(code);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    broadcast(session, { type: 'expired' });
    session.clients.forEach((client) => client.end());
    sessions.delete(code);
    return null;
  }
  return session;
};

/**
 * Hold the connection open and stream this session's events. The current
 * photos are sent first so a laptop that reconnects catches up in one frame.
 */
const openStream = (session, req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Without this an intermediate proxy may buffer the stream into silence.
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'session', session: publicSession(session) })}\n\n`);

  session.clients.add(res);
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed below */ } }, HEARTBEAT_MS);
  const close = () => { clearInterval(heartbeat); session.clients.delete(res); };
  req.on('close', close);
  req.on('error', close);
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
            const session = { code, plate, shots, status: 'open', photos: {}, clients: new Set(), createdAt: Date.now(), updatedAt: Date.now() };
            sessions.set(code, session);
            return send(res, 201, publicSession(session));
          }
          const session = liveSession(parts[0]);
          if (!session) return send(res, 404, { error: 'This capture link has expired. Generate a new QR code on your computer.' });
          if (req.method === 'GET' && parts.length === 1) return send(res, 200, publicSession(session));
          if (req.method === 'GET' && parts[1] === 'events') return openStream(session, req, res);
          if (req.method === 'PUT' && parts[1] === 'photos' && parts[2]) {
            const { dataUrl } = await readJson(req);
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return send(res, 400, { error: 'A JPEG data URL is required.' });
            const key = parts[2];
            session.photos[key] = dataUrl;
            session.updatedAt = Date.now();
            broadcast(session, { type: 'photo', key, dataUrl, count: Object.keys(session.photos).length });
            return send(res, 200, publicSession(session));
          }
          if (req.method === 'POST' && parts[1] === 'complete') {
            session.status = 'complete';
            session.updatedAt = Date.now();
            broadcast(session, { type: 'complete', count: Object.keys(session.photos).length });
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
