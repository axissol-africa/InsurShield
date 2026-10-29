import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { eq, sql } from 'drizzle-orm';
import { Public } from '../src/common/auth/auth.guard.js';
import { testDatabase } from '../src/config/env.js';
import { documents, policies } from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInspection,
  buildInsurer,
  buildNcdCode,
  buildPurchasedPolicy,
  buildStaffUser,
} from './builders.js';
import { assertCurrentBuild, resetTestDatabase } from './global-setup.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, trustedOrigin } from './sessions.js';
import { createScratchDatabase } from './scratch-database.js';

const WEB_ORIGIN = 'https://web.insurshield.invalid';

class ProbeBody {
  @IsString()
  name!: string;
}

@Public()
@Controller('harness-probe')
class ProbeController {
  @Post()
  echo(@Body() body: ProbeBody) {
    return { name: body.name, isProbeBody: body instanceof ProbeBody };
  }
}

describe('the e2e app', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp({ controllers: [ProbeController], env: { CORS_ORIGINS: WEB_ORIGIN } });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('serves the routes under the API prefix', async () => {
    await testApp.http.get('/api/v1').expect(200).expect('Hello World!');
    await testApp.http.get('/').expect(404);
  });

  it('serves the health routes outside the API prefix', async () => {
    await testApp.http.get('/health').expect(200);
    await testApp.http.get('/api/v1/health').expect(404);
  });

  it('validates and transforms request bodies, refusing unknown fields', async () => {
    await testApp.http
      .post('/api/v1/harness-probe')
      .send({ name: 'Mwila' })
      .expect(201, { name: 'Mwila', isProbeBody: true });
    const missing = await testApp.http.post('/api/v1/harness-probe').send({}).expect(400);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: expect.any(Array) } });
    const extra = await testApp.http.post('/api/v1/harness-probe').send({ name: 'Mwila', role: 'ADMIN' }).expect(400);
    expect(extra.body.code).toBe('VALIDATION_FAILED');
  });

  it('answers an unknown route with the error body', async () => {
    const { body } = await testApp.http.get('/api/v1/no-such-route').expect(404);
    expect(body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), details: null });
  });

  it('allows credentialed requests from the configured origins only', async () => {
    const allowed = await testApp.http.get('/api/v1').set('Origin', WEB_ORIGIN).expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const other = await testApp.http.get('/api/v1').set('Origin', 'https://elsewhere.invalid').expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gives the app a Drizzle handle on the test database', async () => {
    const { rows } = await testApp.db.execute<{ name: string }>(sql`SELECT pg_catalog.current_database() AS name`);
    expect(rows[0].name).toMatch(/_test$/);
  });

  it('keeps uploaded objects in memory', async () => {
    const key = testApp.storage.buildKey({ kind: 'certificate', policyNumber: 'POL-1' }, 'a b.pdf');
    await testApp.storage.put(key, Buffer.from('%PDF'), 'application/pdf');
    expect(testApp.storage.objects.get(key)).toEqual({ body: Buffer.from('%PDF'), contentType: 'application/pdf' });
  });

  it('binds the in-memory storage in place of StorageService', () => {
    expect(testApp.app.get(StorageService)).toBe(testApp.storage);
  });
});

describe('e2e sessions', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('runs the app with the limiter off and no trusted proxy, as the global setup sets them', () => {
    expect(process.env.AUTH_RATE_LIMIT).toBe('off');
    expect(process.env.TRUST_PROXY_HOPS).toBe('0');
  });

  it('signs in a built customer with the test password, from the run’s trusted origin', async () => {
    const customer = await buildCustomer(testApp.db);

    const session = await signIn(testApp.http, customer);

    expect(session.Origin).toBe(trustedOrigin());
    const me = await testApp.http.get('/api/v1/auth/me').set(session).expect(200);
    expect(me.body.customer.id).toBe(customer.id);
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'INSURER_USER'] as const)('signs in a built %s', async (role) => {
    const staff =
      role === 'INSURER_USER' ? (await buildInsurer(testApp.db)).staff : await buildStaffUser(testApp.db, { role });

    const me = await testApp.http.get('/api/v1/auth/me').set(await signIn(testApp.http, staff)).expect(200);

    expect(me.body.staffSession.id).toBe(staff.id);
  });

  it('builds a row with no login when told to, which cannot sign in', async () => {
    const customer = await buildCustomer(testApp.db, { userId: null });

    expect(customer.userId).toBeNull();
    await expect(signIn(testApp.http, customer)).rejects.toThrow('answered 401');
  });
});

describe('e2e builders', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('build a purchased policy whose rows link up', async () => {
    const built = await buildPurchasedPolicy(testApp.db);
    expect(built.recipients.map((recipient) => recipient.insurerId)).toEqual([built.insurer.insurer.id]);
    expect(built.insurer.staff).toMatchObject({ role: 'INSURER_USER', insurerId: built.insurer.insurer.id });
    expect(built.insurer.contact.insurerId).toBe(built.insurer.insurer.id);
    expect(built.quotation.uploadedByStaffId).toBe(built.insurer.staff.id);
    expect(built.payment).toMatchObject({ status: 'CONFIRMED', amountMinor: built.quote.premiumMinor });
    const [policy] = await testApp.db
      .select()
      .from(policies)
      .where(eq(policies.policyNumber, built.policy.policyNumber));
    expect(policy).toMatchObject({
      customerId: built.customer.id,
      insurerId: built.insurer.insurer.id,
      paymentId: built.payment.id,
      quoteDocumentId: built.quotation.id,
    });
  });

  it('build claims, NCD codes, inspections and documents, each with unique keys', async () => {
    const first = await buildPurchasedPolicy(testApp.db);
    const second = await buildPurchasedPolicy(testApp.db, { insurer: first.insurer });
    expect(second.customer.email).not.toBe(first.customer.email);
    const claim = await buildClaim(testApp.db, {
      insurerId: first.insurer.insurer.id,
      customerId: first.customer.id,
      policyNumber: first.policy.policyNumber,
    });
    expect(claim.estimatedLossMinor).toBeNull();
    const code = await buildNcdCode(testApp.db, { insurerId: first.insurer.insurer.id });
    expect(code.redeemedAt).toBeNull();
    const inspection = await buildInspection(testApp.db, {
      customerId: first.customer.id,
      insurerId: first.insurer.insurer.id,
    });
    expect(inspection.status).toBe('REQUESTED');
    const upload = await buildDocument(testApp.db, { customerId: first.customer.id }, { kind: 'CLAIM_ATTACHMENT' });
    const [stored] = await testApp.db.select().from(documents).where(eq(documents.id, upload.id));
    expect(stored).toMatchObject({ uploadedByCustomerId: first.customer.id, uploadedByStaffId: null });
  });
});

describe('e2e global setup', () => {
  it('refuses to reset a database other than the one it expects, and leaves it as it was', async () => {
    const other = await createScratchDatabase('harness');
    try {
      const client = await other.connect();
      await client.query('CREATE TABLE sentinel (id int)');
      await client.end();

      await expect(resetTestDatabase(other.config, testDatabase().name)).rejects.toThrow(
        'Refusing to reset: the server opened a different database than TEST_DATABASE_URL names',
      );

      const after = await other.connect();
      const { rows } = await after.query<{ found: boolean }>(
        "SELECT pg_catalog.to_regclass('public.sentinel') IS NOT NULL AS found",
      );
      await after.end();
      expect(rows[0].found).toBe(true);
    } finally {
      await other.drop();
    }
  });

  it('refuses a database name without the _test suffix before connecting', async () => {
    await expect(resetTestDatabase({ host: '127.0.0.1', port: 1 }, 'insurshield')).rejects.toThrow(
      'Refusing to reset: the database name must end in _test',
    );
  });

  describe('the build check', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'p2-build-check-'));
      mkdirSync(join(root, 'dist', 'db'), { recursive: true });
      mkdirSync(join(root, 'src', 'db'), { recursive: true });
      writeFileSync(join(root, 'src', 'db', 'migrate.ts'), '');
      writeFileSync(join(root, 'src', 'db', 'migrate.spec.ts'), '');
      writeFileSync(join(root, 'dist', 'db', 'migrate.js'), '');
      const past = new Date(Date.now() - 60_000);
      utimesSync(join(root, 'src', 'db', 'migrate.ts'), past, past);
      utimesSync(join(root, 'src', 'db', 'migrate.spec.ts'), past, past);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('accepts a build newer than every source', () => {
      expect(() => assertCurrentBuild(root)).not.toThrow();
    });

    it('ignores specs, which the build does not contain', () => {
      writeFileSync(join(root, 'src', 'db', 'migrate.spec.ts'), 'changed');
      expect(() => assertCurrentBuild(root)).not.toThrow();
    });

    it('refuses a build older than a source', () => {
      writeFileSync(join(root, 'src', 'db', 'migrate.ts'), 'changed');
      expect(() => assertCurrentBuild(root)).toThrow(
        'The API build is older than src/: run npm run build -w @insurshield/api before the e2e suite',
      );
    });

    it('refuses when there is no build', () => {
      rmSync(join(root, 'dist'), { recursive: true });
      expect(() => assertCurrentBuild(root)).toThrow('There is no API build');
    });
  });
});
