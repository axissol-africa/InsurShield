import { createServer, Socket, type Server } from 'node:net';
import { ClamdScanner, type ClamdSettings } from './clamd.scanner.js';

// This is a controlled local protocol fixture, never a provisioned daemon or real malware.
const LOOPBACK = '127.0.0.1';
const sockets = new Set<Socket>();
const servers = new Set<Server>();
const timers = new Set<ReturnType<typeof setInterval>>();

async function fixture(onConnection: (socket: Socket) => void) {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK, port: 0 }, resolve);
  });
  servers.add(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture did not bind TCP.');
  const settings: ClamdSettings = { address: LOOPBACK, port: address.port, timeoutMs: 2000, maxResponseBytes: 4096, maxInputBytes: 1024 * 1024 };
  return { settings, server };
}

function whenStreamReceived(socket: Socket, reply: (wire: Buffer) => void) {
  let wire = Buffer.alloc(0);
  let replied = false;
  socket.on('data', (part: Buffer) => {
    wire = Buffer.concat([wire, part]);
    if (replied || wire.length < 10 || wire.subarray(0, 10).toString() !== 'zINSTREAM\0') return;
    let offset = 10;
    while (offset + 4 <= wire.length) {
      const length = wire.readUInt32BE(offset);
      offset += 4;
      if (length === 0) {
        replied = true;
        reply(wire);
        return;
      }
      if (offset + length > wire.length) return;
      offset += length;
    }
  });
}

afterEach(async () => {
  for (const timer of timers) clearInterval(timer);
  timers.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe('ClamdScanner over controlled loopback TCP', () => {
  it('sends exact INSTREAM framing, chunks binary payload and terminates with a zero length', async () => {
    let captured: Buffer = Buffer.alloc(0);
    const { settings } = await fixture((socket) => whenStreamReceived(socket, (wire) => {
      captured = wire;
      socket.end('stream: OK\0');
    }));
    const payload = Buffer.alloc(150_001, 0xa5);
    payload[0] = 0;
    await expect(new ClamdScanner(settings).scan(payload)).resolves.toEqual({ result: 'clean' });
    expect(captured.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    let offset = 10;
    const chunks: Buffer[] = [];
    for (const length of [65536, 65536, 18929, 0]) {
      expect(captured.readUInt32BE(offset)).toBe(length);
      offset += 4;
      chunks.push(captured.subarray(offset, offset + length));
      offset += length;
    }
    expect(offset).toBe(captured.length);
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it('frames an empty stream and accepts a fragmented clean reply only at EOF', async () => {
    let captured: Buffer = Buffer.alloc(0);
    const { settings } = await fixture((socket) => whenStreamReceived(socket, (wire) => {
      captured = wire;
      socket.write('stre');
      setImmediate(() => { socket.write('am: '); setImmediate(() => socket.end('OK\0')); });
    }));
    await expect(new ClamdScanner(settings).scan(Buffer.alloc(0))).resolves.toEqual({ result: 'clean' });
    expect(captured).toEqual(Buffer.concat([Buffer.from('zINSTREAM\0'), Buffer.alloc(4)]));
  });

  it('returns a fixed detection marker rather than provider-controlled text', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => socket.end('stream: private-provider-text FOUND\0')));
    await expect(new ClamdScanner(settings).scan(Buffer.from('safe synthetic sample'))).resolves.toEqual({ result: 'infected', signature: 'ClamAV-detection' });
  });

  it.each([
    '', 'stream: OK', 'stream: OK\n', 'stream: OK\0trailing', 'stream: OK\0stream: secret FOUND\0',
    'stream: secret ERROR\0', 'INSTREAM size limit exceeded. ERROR\0', 'UNKNOWN COMMAND\0',
    'file: OK\0', 'stream: FOUND\0', 'stream: secret\nFOUND\0', 'stream: \uFFFD FOUND\0',
  ])('fails closed on malformed/error response %j without returning provider text', async (reply) => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => socket.end(reply)));
    await expect(new ClamdScanner(settings).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_INVALID_RESPONSE' });
  });

  it('rejects trailing records arriving after a complete-looking clean reply', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => {
      socket.write('stream: OK\0');
      setImmediate(() => socket.end('stream: synthetic FOUND\0'));
    }));
    await expect(new ClamdScanner(settings).scan(Buffer.from('safe'))).resolves.toMatchObject({ result: 'unavailable' });
  });

  it('refuses a clean reply sent before the complete input was delivered, even if EOF arrives later', async () => {
    const payload = Buffer.alloc(16 * 1024 * 1024);
    const expectedBytes = 10 + payload.length + 4 * (payload.length / 65536 + 1);
    const { settings } = await fixture((socket) => {
      socket.write('stream: OK\0');
      let received = 0;
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received === expectedBytes) socket.end();
      });
    });
    await expect(new ClamdScanner({ ...settings, maxInputBytes: payload.length }).scan(payload)).resolves.toMatchObject({ result: 'unavailable' });
  });

  it('starts the deadline before connection establishment', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect').mockReturnThis();
    try {
      const scanner = new ClamdScanner({ address: LOOPBACK, port: 1, timeoutMs: 100, maxResponseBytes: 256, maxInputBytes: 10 });
      await expect(scanner.scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_TIMEOUT' });
    } finally {
      connect.mockRestore();
    }
  });

  it('bounds the accumulated response across packets', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => {
      socket.write(Buffer.alloc(200, 65));
      setImmediate(() => socket.end(Buffer.alloc(200, 66)));
    }));
    await expect(new ClamdScanner({ ...settings, maxResponseBytes: 256 }).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_RESPONSE_TOO_LARGE' });
  });

  it('enforces a total deadline even while the peer trickles response bytes', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => {
      const timer = setInterval(() => socket.write('s'), 10);
      timers.add(timer);
      socket.on('close', () => clearInterval(timer));
    }));
    await expect(new ClamdScanner({ ...settings, timeoutMs: 100 }).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_TIMEOUT' });
  });

  it('does not accept OK from a peer that never closes the response', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, () => socket.write('stream: OK\0')));
    await expect(new ClamdScanner({ ...settings, timeoutMs: 100 }).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_TIMEOUT' });
  });

  it('times out a non-reading peer without buffering unbounded writes', async () => {
    const { settings } = await fixture((socket) => socket.pause());
    await expect(new ClamdScanner({ ...settings, timeoutMs: 100, maxInputBytes: 16 * 1024 * 1024 }).scan(Buffer.alloc(16 * 1024 * 1024))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_TIMEOUT' });
  });

  it('fails closed on connection reset and never exposes the destination', async () => {
    const { settings } = await fixture((socket) => socket.destroy());
    const verdict = await new ClamdScanner(settings).scan(Buffer.alloc(1024 * 1024));
    expect(verdict.result).toBe('unavailable');
    expect(JSON.stringify(verdict)).not.toContain(settings.address);
    expect(JSON.stringify(verdict)).not.toContain(String(settings.port));
  });

  it('fails closed on refused connections', async () => {
    const { settings, server } = await fixture(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.delete(server);
    await expect(new ClamdScanner(settings).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_CONNECTION_FAILED' });
  });

  it('rejects oversized input before connecting', async () => {
    const onConnection = vi.fn();
    const { settings } = await fixture(onConnection);
    await expect(new ClamdScanner({ ...settings, maxInputBytes: 1 }).scan(Buffer.from('safe'))).resolves.toEqual({ result: 'unavailable', reason: 'CLAMD_INPUT_TOO_LARGE' });
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('keeps concurrent requests on independent streams', async () => {
    const { settings } = await fixture((socket) => whenStreamReceived(socket, (wire) => {
      socket.end(wire.includes(Buffer.from('synthetic-detection')) ? 'stream: Synthetic FOUND\0' : 'stream: OK\0');
    }));
    const scanner = new ClamdScanner(settings);
    await expect(Promise.all([scanner.scan(Buffer.from('safe')), scanner.scan(Buffer.from('synthetic-detection'))])).resolves.toEqual([
      { result: 'clean' }, { result: 'infected', signature: 'ClamAV-detection' },
    ]);
  });
});
