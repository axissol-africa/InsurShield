import { and, eq } from 'drizzle-orm';
import { QuoteRequestDraftPurge } from '../src/customer/quote-request-draft-purge.js';
import {
  documents,
  customers,
  insurerEvidence,
  insurerProductVersions,
  insurerProducts,
  quoteRequestDraftDocuments,
  quoteRequestDrafts,
} from '../src/db/schema.js';
import { buildCustomer, buildDocument, buildInsurer, unique, type Row } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Customer = Row<typeof customers>;

const DRAFTS = '/api/v1/quote-request-drafts';

describe('quote request drafts', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const asCustomer = (customer: Customer) => signIn(testApp.http, customer);

  const input = (productVersionId?: string, documentReferences: unknown[] = []) => ({
    commonAnswers: {
      insuranceType: 'Comprehensive',
      coverageDurationId: '4q',
      vehicleValue: 250_000,
      vehicleUsage: 'Individual',
    },
    selectedProductVersionIds: productVersionId ? [productVersionId] : [],
    configurableAnswers: { declarations: { accepted: true } },
    documentReferences,
  });

  async function currentProductVersion() {
    const insurer = await buildInsurer(testApp.db);
    await testApp.db.insert(insurerEvidence).values({
      insurerId: insurer.insurer.id,
      kind: 'LICENCE',
      state: 'APPROVED',
      reference: unique('licence'),
    });
    const [product] = await testApp.db
      .insert(insurerProducts)
      .values({ insurerId: insurer.insurer.id, code: unique('DRAFT'), coverType: 'COMPREHENSIVE' })
      .returning();
    const [version] = await testApp.db
      .insert(insurerProductVersions)
      .values({
        productId: product.id,
        versionNumber: 1,
        status: 'APPROVED',
        name: 'Draft-ready comprehensive cover',
        coverType: 'COMPREHENSIVE',
        coverGuide: { planName: 'Draft-ready comprehensive cover' },
        inspectionRule: 'NOT_REQUIRED',
        rateBps: 500,
        allowedDurations: ['Q4'],
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdByStaffId: insurer.staff.id,
      })
      .returning();
    return { product, version };
  }

  it('keeps only owned, clean document references and returns a resumable draft', async () => {
    const customer = await buildCustomer(testApp.db);
    const headers = await asCustomer(customer);
    const { version } = await currentProductVersion();
    const whiteBook = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK' });
    const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO' });

    const created = await testApp.http
      .post(DRAFTS)
      .set(headers)
      .send(input(version.id, [
        { slot: 'white-book', kind: 'WHITE_BOOK', documentId: whiteBook.id },
        { slot: 'front-view', kind: 'INSPECTION_PHOTO', documentId: photo.id },
      ]))
      .expect(201);

    expect(created.body).toMatchObject({
      commonAnswers: input().commonAnswers,
      selectedProductVersionIds: [version.id],
      configurableAnswers: { declarations: { accepted: true } },
      unavailableProducts: [],
    });
    expect(created.body.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(created.body.documentReferences).toEqual([
      { slot: 'front-view', kind: 'INSPECTION_PHOTO', documentId: photo.id },
      { slot: 'white-book', kind: 'WHITE_BOOK', documentId: whiteBook.id },
    ]);

    const resumed = await testApp.http.get(`${DRAFTS}/${created.body.id}`).set(headers).expect(200);
    expect(resumed.body).toEqual(created.body);
    const stored = await testApp.db
      .select()
      .from(quoteRequestDraftDocuments)
      .where(eq(quoteRequestDraftDocuments.quoteRequestDraftId, created.body.id));
    expect(stored).toHaveLength(2);
  });

  it('keeps drafts private to their customer for read, update and delete', async () => {
    const owner = await buildCustomer(testApp.db);
    const other = await buildCustomer(testApp.db);
    const ownerHeaders = await asCustomer(owner);
    const otherHeaders = await asCustomer(other);
    const created = await testApp.http.post(DRAFTS).set(ownerHeaders).send(input()).expect(201);

    await testApp.http.get(`${DRAFTS}/${created.body.id}`).set(otherHeaders).expect(404);
    await testApp.http.patch(`${DRAFTS}/${created.body.id}`).set(otherHeaders).send({ configurableAnswers: {} }).expect(404);
    await testApp.http.delete(`${DRAFTS}/${created.body.id}`).set(otherHeaders).expect(404);
    await testApp.http.get(`${DRAFTS}/${created.body.id}`).set(ownerHeaders).expect(200);
  });

  it('revalidates selected products on resume without silently accepting an ineligible duration or withdrawn version', async () => {
    const customer = await buildCustomer(testApp.db);
    const headers = await asCustomer(customer);
    const { version } = await currentProductVersion();
    const created = await testApp.http.post(DRAFTS).set(headers).send(input(version.id)).expect(201);

    const durationChanged = await testApp.http
      .patch(`${DRAFTS}/${created.body.id}`)
      .set(headers)
      .send({ commonAnswers: { ...input().commonAnswers, coverageDurationId: '1q' } })
      .expect(200);
    expect(durationChanged.body.unavailableProducts).toEqual([
      expect.objectContaining({ productVersionId: version.id, code: 'PRODUCT_DURATION_UNAVAILABLE' }),
    ]);

    await testApp.db
      .update(insurerProductVersions)
      .set({ status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawalReason: 'Retired terms' })
      .where(eq(insurerProductVersions.id, version.id));
    const resumed = await testApp.http.get(`${DRAFTS}/${created.body.id}`).set(headers).expect(200);
    expect(resumed.body.unavailableProducts).toEqual([
      expect.objectContaining({ productVersionId: version.id, code: 'PRODUCT_VERSION_UNAVAILABLE' }),
    ]);
  });

  it('refuses document references that another customer owns or that have not passed scanning', async () => {
    const customer = await buildCustomer(testApp.db);
    const other = await buildCustomer(testApp.db);
    const headers = await asCustomer(customer);
    const theirs = await buildDocument(testApp.db, { customerId: other.id }, { kind: 'WHITE_BOOK' });
    const unscanned = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK', scanStatus: 'UNSCANNED', scannedAt: null });

    for (const documentId of [theirs.id, unscanned.id]) {
      const response = await testApp.http
        .post(DRAFTS)
        .set(headers)
        .send(input(undefined, [{ slot: 'white-book', kind: 'WHITE_BOOK', documentId }]))
        .expect(409);
      expect(response.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
    }
  });

  it('does not expose, update or retain an expired draft, and purges its document references', async () => {
    const customer = await buildCustomer(testApp.db);
    const headers = await asCustomer(customer);
    const document = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK' });
    const created = await testApp.http
      .post(DRAFTS)
      .set(headers)
      .send(input(undefined, [{ slot: 'white-book', kind: 'WHITE_BOOK', documentId: document.id }]))
      .expect(201);

    await testApp.db
      .update(quoteRequestDrafts)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(quoteRequestDrafts.id, created.body.id));

    await testApp.http.get(`${DRAFTS}/${created.body.id}`).set(headers).expect(404);
    await testApp.http.patch(`${DRAFTS}/${created.body.id}`).set(headers).send({ configurableAnswers: {} }).expect(404);
    await testApp.http.delete(`${DRAFTS}/${created.body.id}`).set(headers).expect(404);

    await testApp.app.get(QuoteRequestDraftPurge).run(new Date());
    const [storedDraft] = await testApp.db.select().from(quoteRequestDrafts).where(eq(quoteRequestDrafts.id, created.body.id));
    const references = await testApp.db
      .select()
      .from(quoteRequestDraftDocuments)
      .where(eq(quoteRequestDraftDocuments.quoteRequestDraftId, created.body.id));
    const [storedDocument] = await testApp.db.select().from(documents).where(eq(documents.id, document.id));
    expect(storedDraft).toBeUndefined();
    expect(references).toEqual([]);
    expect(storedDocument).toBeDefined();
  });

  it('replaces document references atomically when a draft is updated', async () => {
    const customer = await buildCustomer(testApp.db);
    const headers = await asCustomer(customer);
    const first = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK' });
    const second = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK' });
    const created = await testApp.http
      .post(DRAFTS)
      .set(headers)
      .send(input(undefined, [{ slot: 'white-book', kind: 'WHITE_BOOK', documentId: first.id }]))
      .expect(201);

    const updated = await testApp.http
      .patch(`${DRAFTS}/${created.body.id}`)
      .set(headers)
      .send({ documentReferences: [{ slot: 'white-book', kind: 'WHITE_BOOK', documentId: second.id }] })
      .expect(200);
    expect(updated.body.documentReferences).toEqual([{ slot: 'white-book', kind: 'WHITE_BOOK', documentId: second.id }]);
    const references = await testApp.db
      .select()
      .from(quoteRequestDraftDocuments)
      .where(and(eq(quoteRequestDraftDocuments.quoteRequestDraftId, created.body.id), eq(quoteRequestDraftDocuments.documentId, second.id)));
    expect(references).toHaveLength(1);
  });
});
