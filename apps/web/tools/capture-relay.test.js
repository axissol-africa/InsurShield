import { EventEmitter } from 'node:events';
import { beforeAll, describe, expect, it } from 'vitest';
import captureRelay from './capture-relay.js';

const disconnect = (req) => req.emit('close');

let handler;

beforeAll(() => {
  const plugin = captureRelay();
  plugin.configureServer({
    config: { server: { port: 5173 } },
    middlewares: { use: (_path, fn) => { handler = fn; } },
  });
});

const call = (method, url, body) =>
  new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    const res = { setHeader() {}, end(payload) { resolve({ status: res.statusCode, body: JSON.parse(payload) }); } };
    handler(req, res);
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });

/** SSE responses never call end(), so collect the frames they write instead. */
const openStream = (url) => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = url;
  const frames = [];
  const res = {
    headers: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    write(chunk) { frames.push(chunk); return true; },
    end() {},
    setHeader() {},
  };
  handler(req, res);
  return { req, res, frames, events: () => frames.filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6))) };
};

describe('capture relay', () => {
  it('reports a reachable origin', async () => {
    const { status, body } = await call('GET', '/host');
    expect(status).toBe(200);
    expect(body.origin).toMatch(/^http:\/\/.+:5173$/);
  });

  it('runs a session from creation to completion', async () => {
    const created = await call('POST', '/', { plate: 'BAA 1234', shots: ['insp_front'] });
    expect(created.status).toBe(201);
    expect(created.body.code).toHaveLength(6);
    expect(created.body.status).toBe('open');

    const { code } = created.body;
    const photo = await call('PUT', `/${code}/photos/insp_front`, { dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(photo.status).toBe(200);
    expect(photo.body.photos.insp_front).toBe('data:image/jpeg;base64,AAAA');

    const fetched = await call('GET', `/${code}`);
    expect(fetched.body.plate).toBe('BAA 1234');

    const done = await call('POST', `/${code}/complete`);
    expect(done.body.status).toBe('complete');
  });

  it('rejects non-image payloads and unknown codes', async () => {
    const { code } = (await call('POST', '/', { plate: 'X', shots: [] })).body;
    expect((await call('PUT', `/${code}/photos/insp_front`, { dataUrl: 'hello' })).status).toBe(400);
    expect((await call('GET', '/NOPE00')).status).toBe(404);
    expect((await call('DELETE', `/${code}`)).status).toBe(404);
  });

  it('streams each photo to a watching laptop as it arrives', async () => {
    const { code } = (await call('POST', '/', { plate: 'BAA 1234', shots: ['insp_front', 'insp_back'] })).body;
    const stream = openStream(`/${code}/events`);

    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers['Content-Type']).toBe('text/event-stream');
    // The first frame carries the session so a reconnecting laptop catches up.
    expect(stream.events()[0]).toMatchObject({ type: 'session', session: { code, plate: 'BAA 1234' } });

    await call('PUT', `/${code}/photos/insp_front`, { dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(stream.events().at(-1)).toEqual({ type: 'photo', key: 'insp_front', dataUrl: 'data:image/jpeg;base64,AAAA', count: 1 });

    await call('POST', `/${code}/complete`);
    expect(stream.events().at(-1)).toEqual({ type: 'complete', count: 1 });
  });

  it('sends a catch-up frame holding photos taken before the laptop connected', async () => {
    const { code } = (await call('POST', '/', { plate: 'BAA 1234', shots: ['insp_front'] })).body;
    await call('PUT', `/${code}/photos/insp_front`, { dataUrl: 'data:image/jpeg;base64,BBBB' });

    const stream = openStream(`/${code}/events`);
    expect(stream.events()[0].session.photos).toEqual({ insp_front: 'data:image/jpeg;base64,BBBB' });
  });

  it('stops writing to a laptop that has disconnected', async () => {
    const { code } = (await call('POST', '/', { plate: 'BAA 1234', shots: ['insp_front'] })).body;
    const stream = openStream(`/${code}/events`);
    const before = stream.frames.length;

    disconnect(stream.req);
    await call('PUT', `/${code}/photos/insp_front`, { dataUrl: 'data:image/jpeg;base64,CCCC' });

    expect(stream.frames.length).toBe(before);
  });

  it('rejects malformed JSON', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/';
    const result = await new Promise((resolve) => {
      handler(req, { setHeader() {}, statusCode: 0, end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload) }); } });
      req.emit('data', Buffer.from('{not json'));
      req.emit('end');
    });
    expect(result.status).toBe(400);
  });
});
