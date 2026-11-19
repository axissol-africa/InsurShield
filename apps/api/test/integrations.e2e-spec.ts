import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { canonicalJson } from '../src/common/json/canonical-json.js';
import { IntegrationSecretsService } from '../src/integrations/integration-secrets.service.js';
import { INTEGRATION_DELIVERY_JOB, IntegrationsService } from '../src/integrations/integrations.service.js';
import type { JobRow } from '../src/jobs/jobs.repository.js';
import { auditLogs, integrationDeliveries, insurerIntegrations, insurers, jobs } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const SECRET_KEY = Buffer.alloc(32, 7).toString('base64');

describe('the integration platform', () => {
  let testApp: TestApp;
  let integrations: IntegrationsService;
  let secrets: IntegrationSecretsService;

  beforeAll(async () => {
    testApp = await startApp({ env: { INTEGRATION_SECRETS_KEY: SECRET_KEY } });
    integrations = testApp.app.get(IntegrationsService);
    secrets = testApp.app.get(IntegrationSecretsService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function queueRtsa(referenceId = randomUUID()) {
    return testApp.db.transaction((tx) =>
      integrations.queue(tx, {
        targetKind: 'RTSA',
        kind: 'VEHICLE_LOOKUP',
        referenceId,
        endpoint: 'https://registry.example/vehicles',
        requestPayload: { plateNumber: 'ABC 1234' },
      }),
    );
  }

  /**
   * Runs this test's exact delivery handler. The shared test database can hold
   * unrelated jobs from other parallel spec files, so a global runner tick
   * would make an integration assertion depend on another suite's queue.
   */
  async function processDelivery(deliveryId: string) {
    const [job] = await testApp.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, INTEGRATION_DELIVERY_JOB), eq(jobs.key, deliveryId)));
    if (!job) throw new Error('The queued integration delivery had no job.');
    await (integrations as unknown as { processJob: (queued: JobRow) => Promise<void> }).processJob(job);
  }

  it('creates one durable delivery and one job when the same business fact is queued twice', async () => {
    const referenceId = randomUUID();
    const first = await queueRtsa(referenceId);
    const second = await queueRtsa(referenceId);

    expect(second.id).toBe(first.id);
    const deliveries = await testApp.db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, first.id));
    const deliveryJobs = await testApp.db.select().from(jobs).where(eq(jobs.key, first.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveryJobs).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ targetKind: 'RTSA', attempt: 0, status: 'PENDING' });
  });

  it('turns an unavailable provider into a visible exception and records a one-time manual fallback', async () => {
    const queued = await queueRtsa();

    await processDelivery(queued.id);
    const [failed] = await testApp.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, queued.id));
    expect(failed).toMatchObject({ status: 'FAILED', attempt: 1 });
    expect(failed.error).toContain('No live adapter');

    const operator = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const completed = await integrations.resolveManually(queued.id, 'Completed through the RTSA office process.', {
      kind: 'staff',
      id: operator.id,
      email: operator.email,
      role: operator.role,
      insurerId: operator.insurerId,
    });
    expect(completed.status).toBe('MANUAL_FALLBACK');
    await expect(
      integrations.resolveManually(queued.id, 'Trying to resolve the same item again.', {
        kind: 'staff',
        id: operator.id,
        email: operator.email,
        role: operator.role,
        insurerId: operator.insurerId,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRATION_DELIVERY_NOT_ACTIONABLE' });

    const audit = await testApp.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, queued.id));
    expect(audit.some((entry) => entry.action === 'integration_delivery.manual_fallback')).toBe(true);
  });

  it('encrypts a write-only insurer credential and never returns it from onboarding', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const clientSecret = 'insurer-shared-secret-for-sandbox';

    const response = await testApp.http
      .put(`/api/v1/insurers/${insurer.id}/integration`)
      .set(await signIn(testApp.http, admin))
      .send({
        apiBaseUrl: 'https://api.example.invalid',
        publicSigningKey: 'not-used-for-this-test',
        clientId: `client-${randomUUID()}`,
        clientSecret,
        sandboxMode: true,
      })
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain(clientSecret);
    const [stored] = await testApp.db
      .select()
      .from(insurerIntegrations)
      .where(eq(insurerIntegrations.insurerId, insurer.id));
    expect(stored.clientSecretEncrypted).not.toBe(clientSecret);
    expect(secrets.decrypt(stored.clientSecretEncrypted!)).toBe(clientSecret);
    const parts = stored.clientSecretEncrypted!.split('.');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    ciphertext[0] ^= 1;
    parts[2] = ciphertext.toString('base64url');
    expect(() => secrets.decrypt(parts.join('.'))).toThrow(/stored integration credential cannot be used/i);
  });

  it('fails IPv4-mapped private provider endpoints before making any outbound request, including in sandbox mode', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    await testApp.db.insert(insurerIntegrations).values({
      insurerId: insurer.id,
      apiBaseUrl: 'http://[::ffff:7f00:1]:65535',
      publicSigningKey: 'not-used-for-this-test',
      clientId: `sandbox-${randomUUID()}`,
      clientSecretEncrypted: secrets.encrypt('sandbox-insurer-secret'),
      sandboxMode: true,
    });
    const queued = await testApp.db.transaction((tx) =>
      integrations.queue(tx, {
        insurerId: insurer.id,
        targetKind: 'INSURER_API',
        kind: 'QUOTE_REQUEST',
        referenceId: randomUUID(),
        endpoint: 'http://[::ffff:7f00:1]:65535/quote-requests',
        requestPayload: { quoteRequestId: 'QR-safe-endpoint-test' },
      }),
    );

    await processDelivery(queued.id);
    const [failed] = await testApp.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, queued.id));
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.error).toContain('publicly routable');
  });

  it('refuses a delivery whose endpoint differs from the insurer integration record', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    await testApp.db.insert(insurerIntegrations).values({
      insurerId: insurer.id,
      apiBaseUrl: 'https://api.example.invalid',
      publicSigningKey: 'not-used-for-this-test',
      clientId: `bound-${randomUUID()}`,
      clientSecretEncrypted: secrets.encrypt('bound-insurer-secret'),
      sandboxMode: true,
    });
    const queued = await testApp.db.transaction((tx) =>
      integrations.queue(tx, {
        insurerId: insurer.id,
        targetKind: 'INSURER_API',
        kind: 'QUOTE_REQUEST',
        referenceId: randomUUID(),
        endpoint: 'https://attacker.example/quote-requests',
        requestPayload: { quoteRequestId: 'QR-bound-endpoint-test' },
      }),
    );

    await processDelivery(queued.id);
    const [failed] = await testApp.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, queued.id));
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.error).toContain('approved integration record');
  });

  it('accepts one valid signed callback, replays it safely, and refuses tampering or expiry', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await testApp.db.insert(insurerIntegrations).values({
      insurerId: insurer.id,
      apiBaseUrl: 'https://api.example.invalid',
      publicSigningKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      clientId: `callback-${randomUUID()}`,
    });
    const body = { insurerReference: 'INS-42', requestId: 'QR-42' };
    const eventId = randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const eventType = 'QUOTE_READY';
    const signature = sign(privateKey, timestamp, eventId, eventType, body);
    const request = () =>
      testApp.http
        .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
        .set({
          'X-InsurShield-Event-Id': eventId,
          'X-InsurShield-Event-Type': eventType,
          'X-InsurShield-Timestamp': timestamp,
          'X-InsurShield-Signature': signature,
        })
        .send(body);

    await request().expect(202).expect(({ body: responseBody }) => expect(responseBody).toEqual({ accepted: true, replayed: false }));
    await request().expect(202).expect(({ body: responseBody }) => expect(responseBody).toEqual({ accepted: true, replayed: true }));
    await testApp.http
      .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
      .set({
        'X-InsurShield-Event-Id': eventId,
        'X-InsurShield-Event-Type': eventType,
        'X-InsurShield-Timestamp': timestamp,
        'X-InsurShield-Signature': sign(privateKey, timestamp, eventId, eventType, { ...body, requestId: 'QR-43' }),
      })
      .send({ ...body, requestId: 'QR-43' })
      .expect(409);
    await testApp.http
      .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
      .set({
        'X-InsurShield-Event-Id': eventId,
        'X-InsurShield-Event-Type': 'POLICY_ISSUED',
        'X-InsurShield-Timestamp': timestamp,
        'X-InsurShield-Signature': signature,
      })
      .send(body)
      .expect(401)
      .expect(({ body: responseBody }) => expect(responseBody.code).toBe('INVALID_CALLBACK_SIGNATURE'));
    await testApp.http
      .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
      .set({
        'X-InsurShield-Event-Id': eventId,
        'X-InsurShield-Event-Type': 'POLICY_ISSUED',
        'X-InsurShield-Timestamp': timestamp,
        'X-InsurShield-Signature': sign(privateKey, timestamp, eventId, 'POLICY_ISSUED', body),
      })
      .send(body)
      .expect(409);
    const stale = String(Math.floor(Date.now() / 1_000) - 600);
    await testApp.http
      .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
      .set({
        'X-InsurShield-Event-Id': randomUUID(),
        'X-InsurShield-Event-Type': eventType,
        'X-InsurShield-Timestamp': stale,
        'X-InsurShield-Signature': sign(privateKey, stale, randomUUID(), eventType, body),
      })
      .send(body)
      .expect(401)
      .expect(({ body: responseBody }) => expect(responseBody.code).toBe('STALE_CALLBACK'));
  });

  it('does not accept callbacks for a deleted insurer', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await testApp.db.insert(insurerIntegrations).values({
      insurerId: insurer.id,
      apiBaseUrl: 'https://api.example.invalid',
      publicSigningKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      clientId: `deleted-callback-${randomUUID()}`,
    });
    await testApp.db
      .update(insurers)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(eq(insurers.id, insurer.id));
    const body = { insurerReference: 'INS-deleted', requestId: 'QR-deleted' };
    const eventId = randomUUID();
    const eventType = 'QUOTE_READY';
    const timestamp = String(Math.floor(Date.now() / 1_000));

    await testApp.http
      .post(`/api/v1/integrations/callbacks/insurers/${insurer.id}`)
      .set({
        'X-InsurShield-Event-Id': eventId,
        'X-InsurShield-Event-Type': eventType,
        'X-InsurShield-Timestamp': timestamp,
        'X-InsurShield-Signature': sign(privateKey, timestamp, eventId, eventType, body),
      })
      .send(body)
      .expect(401)
      .expect(({ body: responseBody }) => expect(responseBody.code).toBe('INVALID_CALLBACK_SIGNATURE'));
  });

  it('keeps failed deliveries visible ahead of acknowledged delivery history', async () => {
    const acknowledged = [] as string[];
    for (let index = 0; index < 55; index += 1) {
      const queued = await queueRtsa(`visible-failure-${randomUUID()}-${index}`);
      acknowledged.push(queued.id);
    }
    const failed = await queueRtsa(`visible-failure-${randomUUID()}-failed`);
    await testApp.db
      .update(integrationDeliveries)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date() })
      .where(inArray(integrationDeliveries.id, acknowledged));
    await testApp.db
      .update(integrationDeliveries)
      .set({ status: 'FAILED', error: 'Needs an operator.' })
      .where(eq(integrationDeliveries.id, failed.id));

    const operations = await integrations.listForOperations();
    expect(operations).toHaveLength(50);
    expect(operations.map((delivery) => delivery.id)).toContain(failed.id);
    expect(operations[0].status).toBe('FAILED');
  });

  it('shows an insurer only its own safe delivery summaries', async () => {
    const first = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
    const second = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
    const delivery = await testApp.db.transaction((tx) =>
      integrations.queue(tx, {
        insurerId: first.insurer.id,
        targetKind: 'INSURER_API',
        kind: 'QUOTE_REQUEST',
        referenceId: randomUUID(),
        endpoint: 'https://api.example.invalid/quotes',
        requestPayload: { customerPhone: '+260000000000' },
      }),
    );

    const own = await testApp.http
      .get('/api/v1/insurer/integrations/deliveries')
      .set(await signIn(testApp.http, first.staff))
      .expect(200);
    expect(own.body.map((row: { id: string }) => row.id)).toContain(delivery.id);
    expect(JSON.stringify(own.body)).not.toContain('+260000000000');
    // InsurShield's own operations detail stays on the InsurShield side.
    for (const row of own.body as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('resolvedByStaffId');
      expect(row).not.toHaveProperty('resolutionNote');
      expect(row).not.toHaveProperty('requestHash');
    }

    const other = await testApp.http
      .get('/api/v1/insurer/integrations/deliveries')
      .set(await signIn(testApp.http, second.staff))
      .expect(200);
    expect(other.body.map((row: { id: string }) => row.id)).not.toContain(delivery.id);
  });

  it('refuses a private or loopback insurer URL when the integration is saved', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const base = { publicSigningKey: 'not-used-for-this-test', clientId: `client-${randomUUID()}`, sandboxMode: true };

    for (const [field, value] of [
      ['apiBaseUrl', 'https://169.254.169.254/latest'],
      ['apiBaseUrl', 'https://10.0.0.5/v1'],
      ['quoteCallbackUrl', 'https://localhost/quotes'],
    ] as const) {
      const response = await testApp.http
        .put(`/api/v1/insurers/${insurer.id}/integration`)
        .set(await signIn(testApp.http, admin))
        .send({ ...base, apiBaseUrl: 'https://api.example.invalid', [field]: value })
        .expect(400);
      expect(response.body.details).toHaveProperty(field);
    }
    const [stored] = await testApp.db.select().from(insurerIntegrations).where(eq(insurerIntegrations.insurerId, insurer.id));
    expect(stored).toBeUndefined();
  });

  it('keeps a live integration live when a later save leaves the mode out', async () => {
    const { insurer } = await buildInsurer(testApp.db);
    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const clientId = `client-${randomUUID()}`;
    const save = async (body: Record<string, unknown>) =>
      testApp.http
        .put(`/api/v1/insurers/${insurer.id}/integration`)
        .set(await signIn(testApp.http, admin))
        .send({ apiBaseUrl: 'https://api.example.invalid', publicSigningKey: 'not-used-for-this-test', clientId, ...body })
        .expect(200);

    await save({ sandboxMode: false });
    await save({});
    const [stored] = await testApp.db.select().from(insurerIntegrations).where(eq(insurerIntegrations.insurerId, insurer.id));
    expect(stored.sandboxMode).toBe(false);

    // Still live, so plain HTTP is refused.
    await testApp.http
      .put(`/api/v1/insurers/${insurer.id}/integration`)
      .set(await signIn(testApp.http, admin))
      .send({ apiBaseUrl: 'http://api.example.invalid', publicSigningKey: 'not-used-for-this-test', clientId })
      .expect(400);
  });
});

function sign(
  privateKey: string,
  timestamp: string,
  eventId: string,
  eventType: string,
  body: Record<string, unknown>,
): string {
  const signer = createSign('sha256');
  signer.update(canonicalJson({ timestamp, eventId, eventType, body }));
  signer.end();
  return signer.sign(privateKey).toString('base64url');
}
