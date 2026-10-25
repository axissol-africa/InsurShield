import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import type { Env } from '../src/config/env.js';
import { documents } from '../src/db/schema.js';
import { startApp, type TestApp } from './helpers.js';
import { bearer, customerToken } from './jwks.js';

const UPLOAD = '/api/v1/documents';
const PDF = Buffer.from('%PDF-1.7\n% e2e upload\n');

describe('uploading a document', () => {
  let testApp: TestApp;
  let headers: { Authorization: string };
  let customerId: string;
  let limit: number;

  beforeAll(async () => {
    testApp = await startApp();
    limit = testApp.app.get(ConfigService<Env, true>).get('MAX_UPLOAD_BYTES', { infer: true });
    const keycloakId = randomUUID();
    headers = bearer(await customerToken({ keycloakId, email: `${keycloakId}@example.test` }));
    customerId = (await testApp.http.get('/api/v1/auth/me').set(headers).expect(200)).body.customer.id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('stores the bytes and the metadata, and returns a signed link', async () => {
    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CLAIM_ATTACHMENT')
      .attach('file', PDF, { filename: 'police report.pdf', contentType: 'application/pdf' })
      .expect(201);

    const [row] = await testApp.db.select().from(documents).where(eq(documents.id, response.body.id));
    expect(row).toMatchObject({
      kind: 'CLAIM_ATTACHMENT',
      fileName: 'police report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksumSha256: createHash('sha256').update(PDF).digest('hex'),
      uploadedByCustomerId: customerId,
      uploadedByStaffId: null,
    });
    expect(testApp.storage.objects.get(row.storageKey)).toEqual({ body: PDF, contentType: 'application/pdf' });
    expect(response.body).toEqual({
      id: row.id,
      name: 'police report.pdf',
      type: 'application/pdf',
      size: PDF.length,
      url: await testApp.storage.signedDownloadUrl(row.storageKey, 'police report.pdf'),
    });
  });

  it.each(['image/jpeg', 'image/png'])('accepts %s', async (contentType) => {
    await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'INSPECTION_PHOTO')
      .attach('file', Buffer.from('image bytes'), { filename: 'front.img', contentType })
      .expect(201);
  });

  it('accepts a file of exactly the size limit', async () => {
    await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CERTIFICATE')
      .attach('file', Buffer.alloc(limit), { filename: 'limit.pdf', contentType: 'application/pdf' })
      .expect(201);
  });

  const stored = async () => ({
    objects: testApp.storage.objects.size,
    rows: (
      await testApp.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.uploadedByCustomerId, customerId))
    ).length,
  });

  it.each([
    ['one byte over the limit', (max: number) => max + 1],
    ['four times the limit', (max: number) => 4 * max],
  ])('cuts off a file %s while it streams and stores nothing', async (_case, size) => {
    const before = await stored();

    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CERTIFICATE')
      .attach('file', Buffer.alloc(size(limit)), { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body).toEqual({
      code: 'FILE_TOO_LARGE',
      message: `That file is larger than the ${limit / 1024 / 1024} MB limit.`,
      details: null,
    });
    expect(await stored()).toEqual(before);
  });

  it('refuses a second file part and stores nothing', async () => {
    const before = await stored();

    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CLAIM_ATTACHMENT')
      .attach('file', PDF, { filename: 'one.pdf', contentType: 'application/pdf' })
      .attach('file', PDF, { filename: 'two.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body.code).toBe('BAD_REQUEST');
    expect(await stored()).toEqual(before);
  });

  it('refuses a file part under another name and stores nothing', async () => {
    const before = await stored();

    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CLAIM_ATTACHMENT')
      .attach('other', PDF, { filename: 'other.pdf', contentType: 'application/pdf' })
      .attach('file', PDF, { filename: 'one.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body.code).toBe('BAD_REQUEST');
    expect(await stored()).toEqual(before);
  });

  it('refuses more form fields than an upload has, before validating them', async () => {
    let request = testApp.http.post(UPLOAD).set(headers).field('kind', 'CLAIM_ATTACHMENT');
    for (let index = 0; index < 5; index += 1) request = request.field(`extra${index}`, 'x');

    const response = await request
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body).toEqual({ code: 'BAD_REQUEST', message: 'Too many fields', details: null });
  });

  it('refuses a form field longer than any document kind, before validating it', async () => {
    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'K'.repeat(2048))
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Field value too long') });
  });

  it('refuses a type other than PDF, JPG or PNG', async () => {
    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'CLAIM_ATTACHMENT')
      .attach('file', Buffer.from('plain'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);

    expect(response.body).toEqual({
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Upload the document as a PDF, JPG or PNG.',
      details: null,
    });
  });

  it('refuses a request without a file', async () => {
    const response = await testApp.http.post(UPLOAD).set(headers).field('kind', 'CLAIM_ATTACHMENT').expect(400);

    expect(response.body.code).toBe('FILE_REQUIRED');
  });

  it('refuses an unknown kind', async () => {
    const response = await testApp.http
      .post(UPLOAD)
      .set(headers)
      .field('kind', 'PASSPORT')
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: ['Unknown document kind.'] } });
  });

  it('refuses an upload without a token', async () => {
    await testApp.http
      .post(UPLOAD)
      .field('kind', 'CLAIM_ATTACHMENT')
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(401);
  });
});
