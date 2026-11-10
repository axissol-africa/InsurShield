import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Principal } from '../src/common/auth/auth.types.js';
import type { DocumentKind } from '../src/common/domain/enums.js';
import { auditLogs, documents, policies } from '../src/db/schema.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInspection,
  buildInsurer,
  buildInsurerQuote,
  buildPurchasedPolicy,
  buildQuoteRequest,
  buildStaffUser,
  type Row,
} from './builders.js';
import {
  buildCertificate,
  buildClaimAttachment,
  buildInspectionPhoto,
  buildInspectionShot,
} from './builders/documents.js';
import { openTestDatabase, startApp, until, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';
import type { customers, staffUsers } from '../src/db/schema.js';

type Customer = Row<typeof customers>;
type Staff = Row<typeof staffUsers>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('documents', () => {
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
  const asStaff = (staff: Staff) => signIn(testApp.http, staff);

  describe('GET /documents/:id', () => {
    const docs: Record<string, string> = {};
    const principals: Record<string, SessionHeaders> = {};

    beforeAll(async () => {
      const db = testApp.db;
      const customerA = await buildCustomer(db);
      const customerB = await buildCustomer(db);
      const insurerX = await buildInsurer(db);
      const insurerY = await buildInsurer(db);
      // Second members, so the insurer rows are tested apart from the uploader row.
      const memberX = await buildStaffUser(db, { role: 'INSURER_USER', insurerId: insurerX.insurer.id });
      const memberY = await buildStaffUser(db, { role: 'INSURER_USER', insurerId: insurerY.insurer.id });
      const unattachedMember = await buildStaffUser(db, { role: 'INSURER_USER', insurerId: null });
      const admin = await buildStaffUser(db, { role: 'ADMIN' });
      const superAdmin = await buildStaffUser(db, { role: 'SUPER_ADMIN' });

      for (const [name, customer, insurer, otherInsurer] of [
        ['A', customerA, insurerX, insurerY],
        ['B', customerB, insurerY, insurerX],
      ] as const) {
        const purchase = await buildPurchasedPolicy(db, { customer, insurer });
        docs[`quotation ${name}`] = purchase.quotation.id;
        docs[`certificate ${name}`] = (
          await buildCertificate(db, { policyNumber: purchase.policy.policyNumber, staffId: insurer.staff.id })
        ).id;
        const { quoteRequest } = await buildQuoteRequest(db, {
          customerId: customer.id,
          insurerIds: [otherInsurer.insurer.id],
        });
        docs[`open quotation ${name}`] = (
          await buildInsurerQuote(db, {
            quoteRequestId: quoteRequest.id,
            insurerId: otherInsurer.insurer.id,
            staffId: otherInsurer.staff.id,
          })
        ).document.id;
        docs[`shot ${name}`] = (
          await buildInspectionShot(db, { quoteRequestId: quoteRequest.id, uploader: { customerId: customer.id } })
        ).document.id;
        const claim = await buildClaim(db, {
          insurerId: insurer.insurer.id,
          customerId: customer.id,
          policyNumber: purchase.policy.policyNumber,
        });
        docs[`attachment ${name}`] = (
          await buildClaimAttachment(db, { claimNumber: claim.claimNumber, uploader: { customerId: customer.id } })
        ).document.id;
        const inspection = await buildInspection(db, { customerId: customer.id, insurerId: insurer.insurer.id });
        docs[`photo ${name}`] = (
          await buildInspectionPhoto(db, { inspectionId: inspection.id, uploader: { customerId: customer.id } })
        ).document.id;
        // Uploaded by staff, and a quotation referenced only from a policy, so one relationship alone grants each read.
        const uploader = { staffId: admin.id };
        docs[`staff shot ${name}`] = (await buildInspectionShot(db, { quoteRequestId: quoteRequest.id, uploader })).document.id;
        docs[`staff attachment ${name}`] = (
          await buildClaimAttachment(db, { claimNumber: claim.claimNumber, uploader })
        ).document.id;
        docs[`staff photo ${name}`] = (await buildInspectionPhoto(db, { inspectionId: inspection.id, uploader })).document.id;
        const second = await buildPurchasedPolicy(db, { customer, insurer });
        const policyQuotation = await buildDocument(db, uploader, { kind: 'QUOTATION' });
        await db
          .update(policies)
          .set({ quoteDocumentId: policyQuotation.id })
          .where(eq(policies.policyNumber, second.policy.policyNumber));
        docs[`policy quotation ${name}`] = policyQuotation.id;
        const colleague = await buildStaffUser(db, { role: 'INSURER_USER', insurerId: insurer.insurer.id });
        docs[`colleague certificate ${name}`] = (
          await buildCertificate(db, { policyNumber: second.policy.policyNumber, staffId: colleague.id })
        ).id;
        docs[`upload ${name}`] = (await buildDocument(db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' })).id;
        docs[`staff upload ${name}`] = (await buildDocument(db, { staffId: insurer.staff.id }, { kind: 'CERTIFICATE' })).id;
      }
      docs.logo = (await buildDocument(db, { staffId: admin.id }, { kind: 'INSURER_LOGO' })).id;
      docs['customer logo A'] = (await buildDocument(db, { customerId: customerA.id }, { kind: 'INSURER_LOGO' })).id;

      principals['customer A'] = await asCustomer(customerA);
      principals['customer B'] = await asCustomer(customerB);
      principals['uploader X'] = await asStaff(insurerX.staff);
      principals['member X'] = await asStaff(memberX);
      principals['member Y'] = await asStaff(memberY);
      principals['member of no insurer'] = await asStaff(unattachedMember);
      principals.admin = await asStaff(admin);
      principals['super admin'] = await asStaff(superAdmin);
    });

    const DOCUMENTS = [
      'quotation', 'certificate', 'open quotation', 'shot', 'attachment', 'photo', 'upload', 'staff upload',
      'staff shot', 'staff attachment', 'staff photo', 'policy quotation', 'colleague certificate',
    ];
    const ALL = [
      ...DOCUMENTS.map((document) => `${document} A`),
      ...DOCUMENTS.map((document) => `${document} B`),
      'logo',
      'customer logo A',
    ];
    // Customer A's requests go to X; A's second request, with its open quotation and shots, goes to Y, and B's the
    // other way round.
    const MAY_READ: Record<string, string[]> = {
      'customer A': [
        'quotation A', 'certificate A', 'open quotation A', 'shot A', 'attachment A', 'photo A', 'upload A',
        'staff shot A', 'staff attachment A', 'staff photo A', 'policy quotation A', 'colleague certificate A', 'logo',
        'customer logo A',
      ],
      'customer B': [
        'quotation B', 'certificate B', 'open quotation B', 'shot B', 'attachment B', 'photo B', 'upload B',
        'staff shot B', 'staff attachment B', 'staff photo B', 'policy quotation B', 'colleague certificate B', 'logo',
      ],
      'member X': [
        'quotation A', 'certificate A', 'attachment A', 'photo A', 'staff attachment A', 'staff photo A',
        'policy quotation A', 'colleague certificate A', 'open quotation B', 'shot B', 'staff shot B', 'logo',
      ],
      'member Y': [
        'quotation B', 'certificate B', 'attachment B', 'photo B', 'staff attachment B', 'staff photo B',
        'policy quotation B', 'colleague certificate B', 'open quotation A', 'shot A', 'staff shot A', 'logo',
      ],
      'uploader X': [
        'quotation A', 'certificate A', 'attachment A', 'photo A', 'staff attachment A', 'staff photo A',
        'policy quotation A', 'colleague certificate A', 'open quotation B', 'shot B', 'staff shot B', 'logo',
        'staff upload A',
      ],
      'member of no insurer': ['logo'],
      admin: ALL,
      'super admin': ALL,
    };
    const cases = Object.entries(MAY_READ).flatMap(([principal, readable]) =>
      ALL.map((document) => [principal, document, readable.includes(document)] as const),
    );

    it.each(cases)('%s reading %s: allowed %s', async (principal, document, allowed) => {
      const id = docs[document];

      const response = await testApp.http.get(`/api/v1/documents/${id}`).set(principals[principal]);

      if (allowed) {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          id,
          name: expect.any(String),
          type: expect.any(String),
          size: expect.any(Number),
          url: expect.stringContaining('https://storage.invalid/'),
        });
      } else {
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ code: 'NOT_FOUND', message: `Document ${id} was not found.`, details: null });
      }
    });

    it('answers a document that does not exist the same way', async () => {
      const id = randomUUID();

      const response = await testApp.http.get(`/api/v1/documents/${id}`).set(principals.admin).expect(404);

      expect(response.body).toEqual({ code: 'NOT_FOUND', message: `Document ${id} was not found.`, details: null });
    });

    it('records who was given a link, without the link itself', async () => {
      const id = docs['certificate A'];
      const downloads = async () =>
        side.db
          .select({ actorId: auditLogs.actorId, after: auditLogs.after })
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'document.downloaded')));
      const before = await downloads();

      await testApp.http.get(`/api/v1/documents/${id}`).set(principals.admin).expect(200);

      const after = await downloads();
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)).toMatchObject({ after: { kind: 'CERTIFICATE' } });
      // The link is the secret; the trail records that one was issued, not which.
      expect(JSON.stringify(after)).not.toContain('storage.invalid');
    });

    it('records the links a list response handed out, once for the response', async () => {
      const issues = async () =>
        side.db
          .select({ actorId: auditLogs.actorId, after: auditLogs.after })
          .from(auditLogs)
          .where(eq(auditLogs.action, 'document.links_issued'));
      const before = await issues();

      await testApp.http.get('/api/v1/policies').set(principals['customer A']).expect(200);

      // The entry is written after the response, so the read can outrun it.
      await until(async () => (await issues()).length > before.length, 'the issued-links entry');
      const after = await issues();
      const issued = after.at(-1)?.after as { count: number; kinds: string[] };
      // One entry for the whole response, however many links it carried.
      expect(after).toHaveLength(before.length + 1);
      expect(issued.count).toBeGreaterThan(0);
      expect(issued.kinds.length).toBeGreaterThan(0);
      expect(JSON.stringify(after)).not.toContain('storage.invalid');
    });

    it('keeps each concurrent response to its own count', async () => {
      // The counter is request-scoped through AsyncLocalStorage, and the handler
      // runs when the interceptor's observable is subscribed rather than when it
      // is built. If that context did not survive, concurrent reads would share
      // a log and attribute one customer's links to another.
      const entries = async () =>
        side.db
          .select({ actorId: auditLogs.actorId, after: auditLogs.after })
          .from(auditLogs)
          .where(eq(auditLogs.action, 'document.links_issued'));
      const before = (await entries()).length;
      const readers = ['customer A', 'customer B', 'customer A', 'customer B'] as const;

      await Promise.all(
        readers.map((reader) => testApp.http.get('/api/v1/policies').set(principals[reader]).expect(200)),
      );

      await until(async () => (await entries()).length >= before + readers.length, 'one entry per response');
      const written = (await entries()).slice(before);
      expect(written).toHaveLength(readers.length);
      // Every entry names an actor and carries a count of its own response.
      for (const entry of written) {
        expect(entry.actorId).toEqual(expect.any(String));
        expect((entry.after as { count: number }).count).toBeGreaterThan(0);
      }
      // Two customers read concurrently, so both appear and neither absorbed
      // the other's links.
      expect(new Set(written.map((entry) => entry.actorId)).size).toBe(2);
    });

    it('does not count the direct download twice, which records itself', async () => {
      const id = docs['certificate A'];
      const countOf = async (action: string) =>
        (await side.db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, action))).length;
      const beforeIssued = await countOf('document.links_issued');
      const beforeDownloads = await countOf('document.downloaded');

      await testApp.http.get(`/api/v1/documents/${id}`).set(principals.admin).expect(200);

      expect(await countOf('document.downloaded')).toBe(beforeDownloads + 1);
      expect(await countOf('document.links_issued')).toBe(beforeIssued);
    });

    it('withholds the link of a document that has not been found clean, keeping the record', async () => {
      // Embedded links are signed by DocumentsService.record while a list or
      // detail response is built. Refusing there would fail the whole response,
      // so the record keeps its description and loses only its link.
      const id = docs['certificate A'];
      const service = testApp.app.get(DocumentsService);
      await side.db.update(documents).set({ scanStatus: 'UNSCANNED' }).where(eq(documents.id, id));
      try {
        const record = await service.record(id);

        expect(record).toMatchObject({ id, name: expect.any(String), size: expect.any(Number) });
        expect(record.url).toBeUndefined();
      } finally {
        await side.db.update(documents).set({ scanStatus: 'CLEAN' }).where(eq(documents.id, id));
      }
      await expect(service.record(id)).resolves.toMatchObject({ url: expect.stringContaining('https://') });
    });

    it('still lists a customer policy whose certificate has not been found clean', async () => {
      // The regression the download gate could have caused: one unscanned
      // document must never stop a parent page from loading.
      const id = docs['certificate A'];
      await side.db.update(documents).set({ scanStatus: 'UNSCANNED' }).where(eq(documents.id, id));
      try {
        const response = await testApp.http.get('/api/v1/policies').set(principals['customer A']).expect(200);

        const listed = response.body
          .flatMap((policy: { certificateDocument?: { id: string; url?: string } | null }) =>
            policy.certificateDocument ?? [],
          )
          .find((document: { id: string }) => document.id === id);
        expect(listed, 'the certificate is still described').toBeDefined();
        expect(listed.url, 'but carries no link').toBeUndefined();
      } finally {
        await side.db.update(documents).set({ scanStatus: 'CLEAN' }).where(eq(documents.id, id));
      }
    });

    it('refuses a document that has not been found clean, to everyone', async () => {
      const id = docs['certificate A'];
      await side.db.update(documents).set({ scanStatus: 'UNSCANNED' }).where(eq(documents.id, id));
      try {
        for (const principal of ['super admin', 'admin'] as const) {
          const response = await testApp.http.get(`/api/v1/documents/${id}`).set(principals[principal]).expect(409);

          expect(response.body).toEqual({
            code: 'DOCUMENT_NOT_AVAILABLE',
            message: 'That document is not available for download.',
            details: null,
          });
        }
      } finally {
        await side.db.update(documents).set({ scanStatus: 'CLEAN' }).where(eq(documents.id, id));
      }
    });
  });

  describe('assertAttachable', () => {
    let service: DocumentsService;

    beforeAll(() => {
      service = testApp.app.get(DocumentsService);
    });

    const customerPrincipal = (customer: Customer): Principal => ({ kind: 'customer', id: customer.id, email: customer.email, emailVerified: true });
    const staffPrincipal = (staff: Staff): Principal => ({
      kind: 'staff',
      id: staff.id,
      email: staff.email,
      role: staff.role,
      insurerId: staff.insurerId,
    });
    const attach = (principal: Principal, ids: string[], kind: DocumentKind) =>
      testApp.db.transaction((tx) => service.assertAttachable(tx, principal, ids, kind));
    const NOT_ATTACHABLE = { code: 'DOCUMENT_NOT_ATTACHABLE', status: 409 };

    it('accepts fresh documents the principal uploaded, of the right kind', async () => {
      const customer = await buildCustomer(testApp.db);
      const first = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });
      const second = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

      await expect(attach(customerPrincipal(customer), [first.id, second.id], 'CLAIM_ATTACHMENT')).resolves.toBeUndefined();
    });

    it('refuses a document another principal uploaded, of another kind, or missing', async () => {
      const customer = await buildCustomer(testApp.db);
      const other = await buildCustomer(testApp.db);
      const { staff } = await buildInsurer(testApp.db);
      const othersUpload = await buildDocument(testApp.db, { customerId: other.id }, { kind: 'CLAIM_ATTACHMENT' });
      const wrongKind = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CERTIFICATE' });
      const staffUpload = await buildDocument(testApp.db, { staffId: staff.id }, { kind: 'CLAIM_ATTACHMENT' });
      const me = customerPrincipal(customer);

      await expect(attach(me, [othersUpload.id], 'CLAIM_ATTACHMENT')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [wrongKind.id], 'CLAIM_ATTACHMENT')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [staffUpload.id], 'CLAIM_ATTACHMENT')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [randomUUID()], 'CLAIM_ATTACHMENT')).rejects.toMatchObject(NOT_ATTACHABLE);
    });

    it('refuses a document already referenced from any table', async () => {
      const purchase = await buildPurchasedPolicy(testApp.db);
      const { customer, insurer } = purchase;
      const certificate = await buildCertificate(testApp.db, {
        policyNumber: purchase.policy.policyNumber,
        staffId: insurer.staff.id,
      });
      const shot = await buildInspectionShot(testApp.db, {
        quoteRequestId: purchase.quoteRequest.id,
        uploader: { customerId: customer.id },
      });
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id, customerId: customer.id });
      const attachment = await buildClaimAttachment(testApp.db, {
        claimNumber: claim.claimNumber,
        uploader: { customerId: customer.id },
      });
      const inspection = await buildInspection(testApp.db, { customerId: customer.id });
      const photo = await buildInspectionPhoto(testApp.db, {
        inspectionId: inspection.id,
        uploader: { customerId: customer.id },
      });
      const staff = staffPrincipal(insurer.staff);
      const me = customerPrincipal(customer);

      // The quotation is referenced by the insurer quote and by the policy's quote document.
      await expect(attach(staff, [purchase.quotation.id], 'QUOTATION')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(staff, [certificate.id], 'CERTIFICATE')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [shot.document.id], 'INSPECTION_PHOTO')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [attachment.document.id], 'CLAIM_ATTACHMENT')).rejects.toMatchObject(NOT_ATTACHABLE);
      await expect(attach(me, [photo.document.id], 'INSPECTION_PHOTO')).rejects.toMatchObject(NOT_ATTACHABLE);
    });

    it('refuses a policy quote document referenced only from the policy', async () => {
      const purchase = await buildPurchasedPolicy(testApp.db);
      const staff = staffPrincipal(purchase.insurer.staff);
      const loose = await buildDocument(testApp.db, { staffId: purchase.insurer.staff.id }, { kind: 'QUOTATION' });
      await testApp.db
        .update(policies)
        .set({ quoteDocumentId: loose.id })
        .where(eq(policies.policyNumber, purchase.policy.policyNumber));

      await expect(attach(staff, [loose.id], 'QUOTATION')).rejects.toMatchObject(NOT_ATTACHABLE);
    });

    it('refuses one id named twice with 400 before any check', async () => {
      const customer = await buildCustomer(testApp.db);
      const repeated = randomUUID();

      await expect(
        attach(customerPrincipal(customer), [randomUUID(), repeated, repeated], 'CLAIM_ATTACHMENT'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });

    it('refuses one id named twice in different letter cases with 400', async () => {
      const customer = await buildCustomer(testApp.db);
      const document = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

      await expect(
        attach(customerPrincipal(customer), [document.id, document.id.toUpperCase()], 'CLAIM_ATTACHMENT'),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });

    const lockWaiters = async () => {
      const { rows } = await side.pool.query<{ count: string }>(
        `SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from "documents"%for update%'`,
      );
      return Number(rows[0].count);
    };

    it('lets only one of two concurrent attaches of one certificate succeed', async () => {
      const { insurer, policy: first } = await buildPurchasedPolicy(testApp.db);
      const { policy: second } = await buildPurchasedPolicy(testApp.db, { insurer });
      const [policyOne, policyTwo] = [first.policyNumber, second.policyNumber];
      const certificate = await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'CERTIFICATE' });
      const staff = staffPrincipal(insurer.staff);
      const attachTo = (policyNumber: string, holdOpen?: Promise<void>, attached?: () => void) =>
        testApp.db.transaction(async (tx) => {
          await service.assertAttachable(tx, staff, [certificate.id], 'CERTIFICATE');
          await tx
            .update(policies)
            .set({ certificateDocumentId: certificate.id })
            .where(eq(policies.policyNumber, policyNumber));
          attached?.();
          await holdOpen;
        });

      const hold = deferred();
      const firstAttached = deferred();
      const one = attachTo(policyOne, hold.promise, firstAttached.resolve);
      await Promise.race([firstAttached.promise, one]);
      const two = attachTo(policyTwo);
      const settledTwo = two.then(
        () => 'attached',
        (error: unknown) => error,
      );
      try {
        await until(async () => (await lockWaiters()) === 1, 'the second attach to wait on the document lock');
      } finally {
        hold.resolve();
        await Promise.allSettled([one, settledTwo]);
      }

      await expect(one).resolves.toBeUndefined();
      await expect(settledTwo).resolves.toMatchObject(NOT_ATTACHABLE);
      const rows = await testApp.db
        .select({ policyNumber: policies.policyNumber, certificateDocumentId: policies.certificateDocumentId })
        .from(policies)
        .where(eq(policies.insurerId, insurer.insurer.id));
      expect(rows.filter((row) => row.certificateDocumentId === certificate.id).map((row) => row.policyNumber)).toEqual([
        policyOne,
      ]);
    });

    it('locks documents in id order whatever order the request names them in', async () => {
      const customer = await buildCustomer(testApp.db);
      const me = customerPrincipal(customer);
      const [low, high] = (
        await Promise.all([
          buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' }),
          buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' }),
        ])
      )
        .map((document) => document.id)
        .sort();
      const hold = deferred();
      const lowLocked = deferred();
      const holder = testApp.db.transaction(async (tx) => {
        await service.assertAttachable(tx, me, [low], 'CLAIM_ATTACHMENT');
        lowLocked.resolve();
        await hold.promise;
      });
      // A holder that fails before locking would otherwise leave this wait hanging until the test times out.
      await Promise.race([lowLocked.promise, holder]);

      const waiter = testApp.db.transaction((tx) => service.assertAttachable(tx, me, [high, low], 'CLAIM_ATTACHMENT'));
      const settled = Promise.allSettled([holder, waiter]);
      try {
        await until(async () => (await lockWaiters()) === 1, 'the second request to wait on the lower id');
        // The waiting request has not locked the higher id, so it cannot be half of a deadlock.
        const probe = await side.pool.connect();
        try {
          await probe.query('BEGIN');
          await expect(
            probe.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE NOWAIT', [high]),
          ).resolves.toMatchObject({ rowCount: 1 });
          await probe.query('ROLLBACK');
        } finally {
          probe.release();
        }
      } finally {
        hold.resolve();
        await settled;
      }

      await expect(holder).resolves.toBeUndefined();
      await expect(waiter).resolves.toBeUndefined();
    });
  });
});
