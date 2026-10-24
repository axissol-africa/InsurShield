import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { insurerContacts, insurers } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser, unique, type Row } from './builders.js';
import { openTestDatabase, startApp, until, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';
import type { staffUsers } from '../src/db/schema.js';

const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

const PUBLIC_KEYS = [
  'benefits',
  'contact',
  'coverage',
  'icon',
  'id',
  'inspectionMethod',
  'inspectionRule',
  'inspectionTiming',
  'isBestValue',
  'logoUrl',
  'name',
  'ncdAccepted',
  'plan',
  'quoteValidityDays',
  'ratePercentage',
  'status',
  'tradingName',
  'website',
];
const ADMIN_KEYS = [...PUBLIC_KEYS, 'licenceExpiry', 'licenceNumber', 'registrationNumber', 'tpin'].sort();
const CONTACT_KEYS = ['address', 'contactPerson', 'email', 'hours', 'mobile', 'phone', 'role', 'tagline', 'whatsapp'];

const keysOf = (value: object) => Object.keys(value).sort();

const contactBody = (overrides: Record<string, unknown> = {}) => ({
  contactPerson: 'Mwansa Tembo',
  role: 'Claims manager',
  phone: '+260211111111',
  email: 'claims@example.test',
  ...overrides,
});

const createBody = (overrides: Record<string, unknown> = {}) => ({
  name: unique('Insurer'),
  ratePercentage: 7.5,
  quoteValidityDays: 21,
  coverage: 'Comprehensive',
  contact: contactBody(),
  ...overrides,
});

describe('insurers', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let admin: Row<typeof staffUsers>;
  let asAdmin: { Authorization: string };

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    asAdmin = bearer(await staffToken(admin, ['admin']));
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const stored = async (id: string) => {
    const [row] = await side.db.select().from(insurers).where(eq(insurers.id, id));
    const [contact] = await side.db.select().from(insurerContacts).where(eq(insurerContacts.insurerId, id));
    return { row, contact };
  };

  const create = (body: Record<string, unknown>) => testApp.http.post('/api/v1/insurers').set(asAdmin).send(body);
  const update = (id: string, body: Record<string, unknown>) =>
    testApp.http.patch(`/api/v1/insurers/${id}`).set(asAdmin).send(body);
  const setStatus = (id: string, status: string, as: { Authorization: string }) =>
    testApp.http.patch(`/api/v1/insurers/${id}/status`).set(as).send({ status });

  describe('wire values (T-HTTP1)', () => {
    it('sends the directory with the public keys only, rate as a percentage and NULL benefits as []', async () => {
      const { insurer, contact } = await buildInsurer(testApp.db, {
        insurer: { rateBps: 525, benefits: null, licenceNumber: 'LIC-1', tpin: '1000000001' },
        contact: { tagline: 'Cover that answers', mobile: null },
      });

      const { body } = await testApp.http.get('/api/v1/insurers/directory').expect(200);

      const listed = body.find((entry: { id: string }) => entry.id === insurer.id);
      expect(keysOf(listed)).toEqual(PUBLIC_KEYS);
      expect(keysOf(listed.contact)).toEqual(CONTACT_KEYS);
      expect(listed).toEqual({
        id: insurer.id,
        name: insurer.name,
        tradingName: null,
        status: 'Active',
        ratePercentage: 5.25,
        quoteValidityDays: 14,
        coverage: 'Comprehensive',
        plan: null,
        website: null,
        logoUrl: null,
        ncdAccepted: true,
        inspectionRule: 'OPTIONAL',
        inspectionTiming: 'BEFORE_PAYMENT',
        inspectionMethod: 'SELF_CAPTURE',
        icon: null,
        isBestValue: false,
        benefits: [],
        contact: {
          tagline: 'Cover that answers',
          contactPerson: contact.contactPerson,
          role: contact.role,
          phone: contact.phone,
          mobile: null,
          whatsapp: null,
          email: contact.email,
          address: null,
          hours: null,
        },
      });
    });

    it('sends an insurer with no contact row with contact null', async () => {
      const { insurer } = await buildInsurer(testApp.db);
      await side.db.delete(insurerContacts).where(eq(insurerContacts.insurerId, insurer.id));

      const { body } = await testApp.http.get(`/api/v1/insurers/${insurer.id}`).set(asAdmin).expect(200);

      expect(body.contact).toBeNull();
      expect(keysOf(body)).toEqual(ADMIN_KEYS);
    });

    it('sends the staff record with onboarding details and the licence expiry in milliseconds', async () => {
      const { insurer } = await buildInsurer(testApp.db, {
        insurer: {
          rateBps: 1,
          benefits: ['Towing', 'Windscreen'],
          licenceNumber: 'LIC-2',
          licenceExpiry: new Date('2027-03-04T05:06:07.089Z'),
          registrationNumber: 'REG-2',
          tpin: '1000000002',
        },
      });

      const { body } = await testApp.http.get(`/api/v1/insurers/${insurer.id}`).set(asAdmin).expect(200);

      expect(keysOf(body)).toEqual(ADMIN_KEYS);
      expect(body).toMatchObject({
        ratePercentage: 0.01,
        benefits: ['Towing', 'Windscreen'],
        licenceNumber: 'LIC-2',
        licenceExpiry: '2027-03-04T05:06:07.089Z',
        registrationNumber: 'REG-2',
        tpin: '1000000002',
      });
    });

    it('lists every insurer not deleted, by name, with the staff keys', async () => {
      const prefix = `List ${randomUUID()}`;
      await buildInsurer(testApp.db, { insurer: { name: `${prefix} B`, status: 'INACTIVE' } });
      await buildInsurer(testApp.db, { insurer: { name: `${prefix} A` } });
      await buildInsurer(testApp.db, { insurer: { name: `${prefix} C`, status: 'DELETED', deletedAt: new Date() } });

      const { body } = await testApp.http.get('/api/v1/insurers').set(asAdmin).expect(200);

      const mine = body.filter((entry: { name: string }) => entry.name.startsWith(prefix));
      expect(mine.map((entry: { name: string; status: string }) => [entry.name, entry.status])).toEqual([
        [`${prefix} A`, 'Active'],
        [`${prefix} B`, 'Inactive'],
      ]);
      expect(keysOf(mine[0])).toEqual(ADMIN_KEYS);
      expect(mine[0].licenceExpiry).toBeNull();
    });

    it('leaves inactive and deleted insurers out of the directory', async () => {
      const inactive = await buildInsurer(testApp.db, { insurer: { status: 'INACTIVE' } });
      const deleted = await buildInsurer(testApp.db, { insurer: { status: 'DELETED' } });

      const { body } = await testApp.http.get('/api/v1/insurers/directory').expect(200);

      const ids = body.map((entry: { id: string }) => entry.id);
      expect(ids).not.toContain(inactive.insurer.id);
      expect(ids).not.toContain(deleted.insurer.id);
      const names = body.map((entry: { name: string }) => entry.name);
      expect(names).toEqual([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
    });
  });

  describe('access', () => {
    it('keeps staff routes from customers and insurer users, and deletion for super admins', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const tokens = [bearer(await customerToken(customer)), bearer(await staffToken(staff, ['insurer_user']))];

      for (const token of tokens) {
        await testApp.http.get('/api/v1/insurers').set(token).expect(403);
        await testApp.http.get(`/api/v1/insurers/${insurer.id}`).set(token).expect(403);
        await testApp.http.post('/api/v1/insurers').set(token).send(createBody()).expect(403);
        await testApp.http.patch(`/api/v1/insurers/${insurer.id}`).set(token).send({ plan: 'x' }).expect(403);
        await testApp.http.patch(`/api/v1/insurers/${insurer.id}/status`).set(token).send({ status: 'INACTIVE' }).expect(403);
      }
      await testApp.http.delete(`/api/v1/insurers/${insurer.id}`).set(asAdmin).expect(403);
      await testApp.http.get('/api/v1/insurers').expect(401);
      expect((await stored(insurer.id)).row.status).toBe('ACTIVE');
    });

    it.each(['', '/status'])('answers 404 for an unknown insurer on GET and PATCH%s', async (suffix) => {
      const id = randomUUID();
      const body = suffix ? { status: 'INACTIVE' } : { plan: 'x' };

      if (!suffix) await testApp.http.get(`/api/v1/insurers/${id}`).set(asAdmin).expect(404);
      const response = await testApp.http.patch(`/api/v1/insurers/${id}${suffix}`).set(asAdmin).send(body).expect(404);

      expect(response.body).toEqual({ code: 'NOT_FOUND', message: `Insurer ${id} was not found.`, details: null });
    });

    it('answers 400, not 500, for an id that is not a UUID', async () => {
      const response = await testApp.http.get('/api/v1/insurers/not-a-uuid').set(asAdmin).expect(400);

      expect(response.body.code).toBe('BAD_REQUEST');
    });
  });

  describe('create', () => {
    it('stores the insurer and its contact, the rate in basis points, and answers with the staff keys', async () => {
      const body = createBody({
        tradingName: 'Shield',
        plan: 'Gold',
        licenceNumber: 'LIC-9',
        licenceExpiry: '2027-01-02T03:04:05.006Z',
        registrationNumber: 'REG-9',
        tpin: '1000000009',
        website: 'https://shield.example.test',
        logoUrl: 'https://shield.example.test/logo.png',
        ncdAccepted: false,
        inspectionRule: 'REQUIRED',
        inspectionTiming: 'AFTER_PAYMENT',
        inspectionMethod: 'PHYSICAL',
        icon: 'shield',
        isBestValue: true,
        benefits: ['Towing'],
        contact: contactBody({ tagline: 'Fast', mobile: '+260977111111', whatsapp: '+260977111112', address: 'Cairo Rd', hours: '8-5' }),
      });

      const response = await create(body).expect(201);

      expect(keysOf(response.body)).toEqual(ADMIN_KEYS);
      expect(response.body).toEqual({
        ...body,
        id: expect.any(String),
        status: 'Active',
        ratePercentage: 7.5,
      });
      const { row, contact } = await stored(response.body.id);
      expect(row).toMatchObject({ name: body.name, rateBps: 750, licenceExpiry: new Date('2027-01-02T03:04:05.006Z') });
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      expect(contact).toEqual({ insurerId: row.id, ...(body.contact as object) });
    });

    it('stores absent optional fields with their defaults and benefits as an empty list', async () => {
      const body = createBody({ ratePercentage: 5.25 });

      const response = await create(body).expect(201);

      expect(response.body).toMatchObject({
        ratePercentage: 5.25,
        tradingName: null,
        licenceExpiry: null,
        ncdAccepted: true,
        inspectionRule: 'OPTIONAL',
        benefits: [],
        contact: { tagline: null, mobile: null, contactPerson: 'Mwansa Tembo' },
      });
      const { row } = await stored(response.body.id);
      expect(row).toMatchObject({ rateBps: 525, benefits: [] });
    });

    it.each([
      [0, 400],
      [100.01, 400],
      [7.555, 400],
      [100, 201],
      [0.01, 201],
    ])('answers a rate of %s with %i', async (ratePercentage, status) => {
      await create(createBody({ ratePercentage })).expect(status);
    });

    it.each(['soon', '1', '2028-02-30', '2028-W05', '2028-100', '2028-05-06T10:00'])('refuses a licence expiry of %s with 400 and stores nothing', async (licenceExpiry) => {
      const name = unique('Expiry');

      const response = await create(createBody({ name, licenceExpiry })).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: ['Enter the licence expiry as a date.'] } });
      expect(await side.db.select().from(insurers).where(eq(insurers.name, name))).toEqual([]);
    });

    it('stores a licence expiry sent as a calendar date, and none for an empty one', async () => {
      const dated = await create(createBody({ licenceExpiry: '2028-05-06' })).expect(201);
      const empty = await create(createBody({ licenceExpiry: '' })).expect(201);

      expect(dated.body.licenceExpiry).toBe('2028-05-06T00:00:00.000Z');
      expect((await stored(dated.body.id)).row.licenceExpiry).toEqual(new Date('2028-05-06T00:00:00.000Z'));
      expect(empty.body.licenceExpiry).toBeNull();
      expect((await stored(empty.body.id)).row.licenceExpiry).toBeNull();
    });

    it('refuses fields the contract does not have', async () => {
      const response = await create({ ...createBody(), rateBps: 100 }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('answers 409 INSURER_EXISTS for a name already taken, and stores nothing', async () => {
      const { insurer } = await buildInsurer(testApp.db);
      const before = await side.db.select({ count: sql<number>`count(*)::int` }).from(insurers);

      const response = await create(createBody({ name: insurer.name })).expect(409);

      expect(response.body).toEqual({
        code: 'INSURER_EXISTS',
        message: `An insurer named ${insurer.name} already exists.`,
        details: null,
      });
      const after = await side.db.select({ count: sql<number>`count(*)::int` }).from(insurers);
      expect(after).toEqual(before);
    });

    it('stores neither the insurer nor its contact when the contact cannot be stored (T-AD2)', async () => {
      const name = unique('Atomic');

      await create(createBody({ name, contact: contactBody({ hours: 'nul \u0000 byte' }) })).expect(500);

      expect(await side.db.select().from(insurers).where(eq(insurers.name, name))).toEqual([]);
    });

    it('answers two creates of one name at the same time with one insurer and one 409 (T-X4)', async () => {
      const name = unique('Race');
      const holder = await side.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('LOCK TABLE insurer_contacts IN SHARE MODE');

        const first = create(createBody({ name })).then((response) => response);
        await until(async () => (await waitingInserts()) >= 1, 'the first create to wait on the contact');
        const second = create(createBody({ name })).then((response) => response);
        await until(async () => (await waitingInserts()) >= 2, 'the second create to wait on the first');
        await holder.query('COMMIT');

        const responses = await Promise.all([first, second]);
        expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
        expect(responses.find((response) => response.status === 409)?.body.code).toBe('INSURER_EXISTS');
        expect(await side.db.select().from(insurers).where(eq(insurers.name, name))).toHaveLength(1);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    });

    async function waitingInserts(): Promise<number> {
      const result = await side.pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'insert into "insurer%'`,
      );
      return result.rows[0].waiting;
    }
  });

  describe('update', () => {
    it('changes only the fields sent, the rate in basis points, and advances updatedAt (T-AD2, T-AD3)', async () => {
      const { insurer } = await buildInsurer(testApp.db, {
        insurer: { plan: 'Silver', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      const response = await update(insurer.id, { ratePercentage: 6.75, plan: 'Gold', licenceExpiry: '2028-05-06T07:08:09.010Z' }).expect(200);

      expect(keysOf(response.body)).toEqual(ADMIN_KEYS);
      expect(response.body).toMatchObject({
        name: insurer.name,
        ratePercentage: 6.75,
        plan: 'Gold',
        coverage: insurer.coverage,
        licenceExpiry: '2028-05-06T07:08:09.010Z',
      });
      const { row } = await stored(insurer.id);
      expect(row).toMatchObject({ rateBps: 675, plan: 'Gold', quoteValidityDays: insurer.quoteValidityDays });
      expect(row.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());
    });

    it('clears the licence expiry when sent empty', async () => {
      const { insurer } = await buildInsurer(testApp.db, { insurer: { licenceExpiry: new Date() } });

      const response = await update(insurer.id, { licenceExpiry: '' }).expect(200);

      expect(response.body.licenceExpiry).toBeNull();
    });

    it.each(['soon', '1'])('refuses a licence expiry of %s with 400 and changes nothing', async (licenceExpiry) => {
      const expiry = new Date('2029-03-04T00:00:00.000Z');
      const { insurer } = await buildInsurer(testApp.db, { insurer: { licenceExpiry: expiry, plan: 'Silver' } });

      const response = await update(insurer.id, { licenceExpiry, plan: 'Gold' }).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: ['Enter the licence expiry as a date.'] } });
      expect((await stored(insurer.id)).row).toMatchObject({ licenceExpiry: expiry, plan: 'Silver' });
    });

    it('advances updatedAt when only the contact changes', async () => {
      const { insurer } = await buildInsurer(testApp.db, { insurer: { updatedAt: new Date('2026-01-01T00:00:00.000Z') } });

      await update(insurer.id, { contact: contactBody({ hours: '24/7' }) }).expect(200);

      const { row, contact } = await stored(insurer.id);
      expect(row.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());
      expect(contact.hours).toBe('24/7');
    });

    it('merges the contact fields sent into the stored contact, and creates one where none exists', async () => {
      const withContact = await buildInsurer(testApp.db, { contact: { mobile: '+260977000001', hours: '8-5' } });
      const withoutContact = await buildInsurer(testApp.db);
      await side.db.delete(insurerContacts).where(eq(insurerContacts.insurerId, withoutContact.insurer.id));
      const contact = contactBody({ tagline: 'New', email: 'new@example.test', hours: '24/7' });

      const updated = await update(withContact.insurer.id, { contact }).expect(200);
      const created = await update(withoutContact.insurer.id, { contact }).expect(200);

      const merged = { mobile: '+260977000001', whatsapp: null, address: null, ...contact };
      expect(updated.body.contact).toEqual(merged);
      expect((await stored(withContact.insurer.id)).contact).toEqual({ insurerId: withContact.insurer.id, ...merged });
      const fresh = { mobile: null, whatsapp: null, address: null, ...contact };
      expect(created.body.contact).toEqual(fresh);
      expect((await stored(withoutContact.insurer.id)).contact).toEqual({ insurerId: withoutContact.insurer.id, ...fresh });
    });

    it('changes neither the insurer nor its contact when the contact cannot be stored (T-AD2)', async () => {
      const { insurer, contact } = await buildInsurer(testApp.db);

      await update(insurer.id, { name: unique('Renamed'), contact: contactBody({ hours: 'nul \u0000 byte' }) }).expect(500);

      const after = await stored(insurer.id);
      expect(after.row.name).toBe(insurer.name);
      expect(after.row.updatedAt).toEqual(insurer.updatedAt);
      expect(after.contact).toEqual(contact);
    });

    it('answers 409 INSURER_EXISTS for a name another insurer has', async () => {
      const taken = await buildInsurer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);

      const response = await update(insurer.id, { name: taken.insurer.name }).expect(409);

      expect(response.body).toEqual({
        code: 'INSURER_EXISTS',
        message: `An insurer named ${taken.insurer.name} already exists.`,
        details: null,
      });
    });

    it('answers 404 for a deleted insurer and leaves it unchanged', async () => {
      const { insurer } = await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });

      await update(insurer.id, { plan: 'Revived' }).expect(404);
      await testApp.http.get(`/api/v1/insurers/${insurer.id}`).set(asAdmin).expect(404);

      expect((await stored(insurer.id)).row.plan).toBeNull();
    });
  });

  describe('status and removal', () => {
    it('sets ACTIVE and INACTIVE for an admin, without deletedAt, and answers with the staff keys', async () => {
      const { insurer } = await buildInsurer(testApp.db, { insurer: { updatedAt: new Date('2026-01-01T00:00:00.000Z') } });

      const inactive = await setStatus(insurer.id, 'INACTIVE', asAdmin).expect(200);

      expect(keysOf(inactive.body)).toEqual(ADMIN_KEYS);
      expect(inactive.body.status).toBe('Inactive');
      const { row } = await stored(insurer.id);
      expect(row).toMatchObject({ status: 'INACTIVE', deletedAt: null });
      expect(row.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());

      const active = await setStatus(insurer.id, 'ACTIVE', asAdmin).expect(200);
      expect(active.body.status).toBe('Active');
      expect((await stored(insurer.id)).row).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    });

    it('refuses DELETED through PATCH status for an admin with 403, and changes nothing', async () => {
      const { insurer } = await buildInsurer(testApp.db, { insurer: { updatedAt: new Date('2026-01-01T00:00:00.000Z') } });

      const response = await setStatus(insurer.id, 'DELETED', asAdmin).expect(403);

      expect(response.body).toEqual({ code: 'FORBIDDEN', message: 'You do not have access to this resource.', details: null });
      const { row } = await stored(insurer.id);
      expect(row).toMatchObject({ status: 'ACTIVE', deletedAt: null });
      expect(row.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('sets DELETED through PATCH status for a super admin, with deletedAt, and then answers 404', async () => {
      const superAdmin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
      const asSuperAdmin = bearer(await staffToken(superAdmin, ['super_admin']));
      const { insurer } = await buildInsurer(testApp.db);

      const deleted = await setStatus(insurer.id, 'DELETED', asSuperAdmin).expect(200);

      expect(keysOf(deleted.body)).toEqual(ADMIN_KEYS);
      expect(deleted.body.status).toBe('Deleted');
      const { row } = await stored(insurer.id);
      expect(row.status).toBe('DELETED');
      expect(row.deletedAt).toBeInstanceOf(Date);
      await setStatus(insurer.id, 'ACTIVE', asSuperAdmin).expect(404);
    });

    it('refuses a status outside the list', async () => {
      const { insurer } = await buildInsurer(testApp.db);

      const response = await testApp.http
        .patch(`/api/v1/insurers/${insurer.id}/status`)
        .set(asAdmin)
        .send({ status: 'Active' })
        .expect(400);

      expect(response.body.details.fields).toEqual(['Status must be Active, Inactive or Deleted.']);
    });

    it('soft-deletes for a super admin', async () => {
      const superAdmin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
      const { insurer } = await buildInsurer(testApp.db);

      const response = await testApp.http
        .delete(`/api/v1/insurers/${insurer.id}`)
        .set(bearer(await staffToken(superAdmin, ['super_admin'])))
        .expect(200);

      expect(response.body).toEqual({ id: insurer.id, status: 'Deleted' });
      const { row, contact } = await stored(insurer.id);
      expect(row.status).toBe('DELETED');
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(contact).toBeDefined();
    });
  });

  it('answers timestamps in milliseconds everywhere they appear', async () => {
    const { insurer } = await buildInsurer(testApp.db, { insurer: { licenceExpiry: new Date('2030-12-31T23:59:59.999Z') } });

    const { body } = await testApp.http.get(`/api/v1/insurers/${insurer.id}`).set(asAdmin).expect(200);

    expect(body.licenceExpiry).toMatch(ISO_MS);
  });
});
