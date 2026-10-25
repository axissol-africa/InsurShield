import { createServer, type AddressInfo, type Server } from 'node:net';
import { Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseError, Pool, type PoolClient } from 'pg';
import { Public } from '../src/common/auth/auth.guard.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, DATABASE, type Database } from '../src/db/database.module.js';
import { DatabaseConnectionError, isRetryableDatabaseError } from '../src/db/errors.js';
import * as schema from '../src/db/schema.js';
import { customers } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, unique } from './builders.js';
import { openTestDatabase, productionPool, RecordingLogger, startApp, type TestApp } from './helpers.js';
import { bearer, signToken } from './jwks.js';

// Values only the failing statements carry: none may reach a response or a log line.
const SECRET_NAME = 'Secret Name 7f3a';
const SECRET_EMAIL_LOCAL = 'secret-7f3a';
const UNHANDLED_DETAIL = 'unhandled detail 7f3a';

// Drizzle writes its statements in lower case, in a message that starts with these markers.
function expectNoStatement(text: string, statement: string) {
  expect(text).not.toContain('Failed query');
  expect(text).not.toContain('params:');
  expect(text).not.toContain(statement);
}

@Public()
@Controller('error-probe')
class ErrorProbeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post('rename/:id')
  async rename(@Param('id') id: string) {
    await this.db.update(customers).set({ fullName: SECRET_NAME }).where(eq(customers.id, id));
  }

  @Post('copy-email-of/:id')
  async copyEmailOf(@Param('id') id: string) {
    const [existing] = await this.db.select().from(customers).where(eq(customers.id, id));
    await buildCustomer(this.db, { email: existing.email, fullName: SECRET_NAME });
  }

  @Post('negative-rate')
  async negativeRate() {
    await buildInsurer(this.db, { insurer: { rateBps: -1, name: SECRET_NAME } });
  }

  @Post('transaction')
  async transaction(@Headers('x-probe-marker') marker: string) {
    await this.db.transaction((tx) => tx.select().from(customers).where(eq(customers.fullName, marker)));
  }

  @Get('unhandled')
  unhandled() {
    throw new Error(UNHANDLED_DETAIL);
  }
}

describe('the error filter', () => {
  let testApp: TestApp;
  let logger: RecordingLogger;

  beforeAll(async () => {
    logger = new RecordingLogger();
    testApp = await startApp({ controllers: [ErrorProbeController], logger });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    logger.lines.length = 0;
  });

  function expectNoSecrets(text: string) {
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_EMAIL_LOCAL);
  }

  it('answers a lock wait beyond the lock timeout with 503 TRY_AGAIN and Retry-After, logging only the SQLSTATE', async () => {
    const customer = await buildCustomer(testApp.db);
    const holder = openTestDatabase();
    const client = await holder.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customer.id]);

      const response = await testApp.http.post(`/api/v1/error-probe/rename/${customer.id}`).expect(503);

      expect(response.headers['retry-after']).toBe('1');
      expect(response.body).toEqual({
        code: 'TRY_AGAIN',
        message: expect.any(String),
        details: null,
      });
      expectNoSecrets(JSON.stringify(response.body));
      expect(logger.text).toContain('55P03');
      expect(logger.text).toContain('TRY_AGAIN');
      expectNoSecrets(logger.text);
      expectNoStatement(logger.text, 'update "customers"');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await holder.close();
    }
  });

  it('answers an unhandled unique violation with 409 CONFLICT, naming neither the constraint nor the value', async () => {
    const existing = await buildCustomer(testApp.db, { email: `${SECRET_EMAIL_LOCAL}@example.invalid` });

    const response = await testApp.http
      .post(`/api/v1/error-probe/copy-email-of/${existing.id}`)
      .expect(409);

    expect(response.body).toEqual({ code: 'CONFLICT', message: expect.any(String), details: null });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('customers_email_key');
    expect(body).not.toContain('email');
    expectNoSecrets(body);
    expect(logger.text).toContain('23505');
    expect(logger.text).toContain('customers_email_key');
    expectNoSecrets(logger.text);
    expectNoStatement(logger.text, 'insert into "customers"');
  });

  it('answers any other database error with 500 INTERNAL_ERROR, logging its SQLSTATE and constraint, not its statement', async () => {
    const response = await testApp.http.post('/api/v1/error-probe/negative-rate').expect(500);

    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      details: null,
    });
    expectNoSecrets(JSON.stringify(response.body));
    expect(logger.text).toContain('23514');
    expect(logger.text).toContain('insurers_rateBps_check');
    expectNoSecrets(logger.text);
    expectNoStatement(logger.text, 'insert into "insurers"');
  });

  it('answers an unknown error with 500 INTERNAL_ERROR and logs its stack on the server only', async () => {
    const response = await testApp.http.get('/api/v1/error-probe/unhandled').expect(500);

    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain(UNHANDLED_DETAIL);
    expect(logger.text).toContain(UNHANDLED_DETAIL);
    expect(logger.text).toContain('error-filter.e2e-spec.ts');
  });

  it('keeps the error body of an ApiException', async () => {
    const { body } = await testApp.http.get('/api/v1/no-such-route').expect(404);
    expect(body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), details: null });
  });

  it('logs the path of a failed request without its query string', async () => {
    await testApp.http.get('/api/v1/error-probe/unhandled').query({ email: `${SECRET_EMAIL_LOCAL}@example.invalid` }).expect(500);
    expect(logger.text).toContain('GET /api/v1/error-probe/unhandled');
    expectNoSecrets(logger.text);
  });
});

// The outage listeners and the pools aimed at them use this address, whatever host the test database is on.
const OUTAGE_HOST = '127.0.0.1';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, OUTAGE_HOST, () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

// A port that was free a moment ago: nothing listens on it, so a connection is refused at once.
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

// A listener that ends every connection before the database handshake completes.
async function hangingUpServer(): Promise<{ port: number; close(): Promise<void> }> {
  const server = createServer((socket) => socket.destroy());
  const port = await listen(server);
  return { port, close: () => close(server) };
}

function testDatabaseOn(port: number): { url: string; address: string } {
  const url = new URL(testDatabase().url);
  url.hostname = OUTAGE_HOST;
  url.port = String(port);
  return { url: url.toString(), address: `${OUTAGE_HOST}:${port}` };
}

function connect(pool: Pool): Promise<{ error: Error | undefined; client: PoolClient | undefined; done: unknown }> {
  return new Promise((resolve) => pool.connect((error, client, done) => resolve({ error, client, done })));
}

function expectNothingOfTheConnectionLogged(text: string, address: string) {
  expect(text).not.toContain(address);
  expect(text).not.toContain('Could not get a database connection');
  expect(text).not.toContain('node_modules');
  expect(text).not.toContain('    at ');
}

describe.each([
  ['refuses every connection', async () => ({ port: await closedPort(), close: async () => {} })],
  ['ends every connection while connecting', () => hangingUpServer()],
])('the error filter when the database %s', (_case, listen) => {
  let testApp: TestApp;
  let logger: RecordingLogger;
  let pool: Pool;
  let address: string;
  let closeListener: () => Promise<void>;

  beforeAll(async () => {
    const listener = await listen();
    closeListener = listener.close;
    const target = testDatabaseOn(listener.port);
    address = target.address;
    pool = productionPool(target.url, 2);
    logger = new RecordingLogger();
    testApp = await startApp({
      controllers: [ErrorProbeController],
      logger,
      override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await pool.end();
    await closeListener();
  });

  beforeEach(() => {
    logger.lines.length = 0;
  });

  it('answers a query behind the auth guard with 503 TRY_AGAIN, logging neither the query nor its parameters', async () => {
    const subject = unique('subject-marker');
    const token = await signToken({ sub: subject, email: `${subject}@example.test`, name: 'Mutale Banda' });

    const response = await testApp.http.get('/api/v1/auth/me').set(bearer(token)).expect(503);

    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual({ code: 'TRY_AGAIN', message: expect.any(String), details: null });
    expect(JSON.stringify(response.body)).not.toContain(subject);
    expect(logger.text).toContain('warn GET /api/v1/auth/me -> 503 TRY_AGAIN');
    expect(logger.text).not.toContain(subject);
    expectNoStatement(logger.text, 'from "customers"');
    expectNothingOfTheConnectionLogged(logger.text, address);
  });

  it('answers a transaction with 503 TRY_AGAIN, logging no stack', async () => {
    const marker = unique('transaction-marker');

    const response = await testApp.http.post('/api/v1/error-probe/transaction').set('x-probe-marker', marker).expect(503);

    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual({ code: 'TRY_AGAIN', message: expect.any(String), details: null });
    expect(logger.text).toContain('warn POST /api/v1/error-probe/transaction -> 503 TRY_AGAIN');
    expect(logger.text).toContain('503 TRY_AGAIN');
    expect(logger.text).not.toContain(marker);
    expectNoStatement(logger.text, 'from "customers"');
    expectNothingOfTheConnectionLogged(logger.text, address);
  });
});

describe('the error filter with a refused connection', () => {
  let testApp: TestApp;
  let logger: RecordingLogger;
  let pool: Pool;

  beforeAll(async () => {
    pool = productionPool(testDatabaseOn(await closedPort()).url, 2);
    logger = new RecordingLogger();
    testApp = await startApp({
      controllers: [ErrorProbeController],
      logger,
      override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await pool.end();
  });

  it.each([
    ['a query', (http: TestApp['http']) => http.post('/api/v1/error-probe/rename/00000000-0000-4000-8000-000000000000')],
    ['a transaction', (http: TestApp['http']) => http.post('/api/v1/error-probe/transaction').set('x-probe-marker', 'refused')],
  ])('logs ECONNREFUSED for %s', async (_case, send) => {
    logger.lines.length = 0;

    await send(testApp.http).expect(503);

    expect(logger.text).toContain('ECONNREFUSED');
  });
});

describe('the error filter when the pool has no client to give', () => {
  let testApp: TestApp;
  let logger: RecordingLogger;
  let pool: Pool;

  beforeAll(async () => {
    pool = productionPool(testDatabase().url, 1);
    logger = new RecordingLogger();
    testApp = await startApp({
      controllers: [ErrorProbeController],
      logger,
      override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await pool.end();
  });

  it('answers a transaction waiting beyond the connection timeout with 503 TRY_AGAIN', async () => {
    const held = await pool.connect();
    try {
      const response = await testApp.http.post('/api/v1/error-probe/transaction').set('x-probe-marker', 'held').expect(503);

      expect(response.headers['retry-after']).toBe('1');
      expect(response.body).toEqual({ code: 'TRY_AGAIN', message: expect.any(String), details: null });
      expect(logger.text).toContain('503 TRY_AGAIN');
      expect(logger.text).not.toContain('timeout exceeded');
      expect(logger.text).not.toContain('    at ');
    } finally {
      held.release();
    }
  });
});

describe("the production pool's connect()", () => {
  let refused: Pool;
  let reachable: Pool;

  beforeAll(async () => {
    refused = productionPool(testDatabaseOn(await closedPort()).url, 1);
    reachable = productionPool(testDatabase().url, 1);
  });

  afterAll(async () => {
    await refused.end();
    await reachable.end();
  });

  it('is still a pg Pool', () => {
    expect(reachable).toBeInstanceOf(Pool);
  });

  it('rejects the promise with a DatabaseConnectionError that keeps the original error', async () => {
    const error: unknown = await refused.connect().then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(DatabaseConnectionError);
    expect((error as Error).cause).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('calls the callback with a DatabaseConnectionError', async () => {
    const { error, client } = await connect(refused);

    expect(error).toBeInstanceOf(DatabaseConnectionError);
    expect(error?.cause).toMatchObject({ code: 'ECONNREFUSED' });
    expect(client).toBeUndefined();
  });

  it('gives a working client by promise, released back to the pool', async () => {
    const client = await reachable.connect();
    const { rows } = await client.query<{ one: number }>('SELECT 1 AS one');
    client.release();

    expect(rows).toEqual([{ one: 1 }]);
    expect(reachable.idleCount).toBe(1);
  });

  it('gives a working client and its release by callback', async () => {
    const { error, client, done } = await connect(reachable);

    expect(error).toBeFalsy();
    expect(typeof done).toBe('function');
    const { rows } = await client!.query<{ one: number }>('SELECT 1 AS one');
    (done as () => void)();

    expect(rows).toEqual([{ one: 1 }]);
    expect(reachable.idleCount).toBe(1);
  });

  it('leaves an error from running a query as the server sent it', async () => {
    const error: unknown = await reachable.query('SELECT 1 / 0').then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: '22012' });
    expect(isRetryableDatabaseError(error)).toBe(false);
  });
});
