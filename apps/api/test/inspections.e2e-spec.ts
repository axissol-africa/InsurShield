import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { InspectionStatus } from '../src/common/domain/enums.js';
import { inspectionPhotos, inspections, insurers, type customers, type documents } from '../src/db/schema.js';
import { buildCustomer, buildDocument, buildInspection, buildInsurer, type Row } from './builders.js';
import { buildInspectionPhoto } from './builders/documents.js';
import { openTestDatabase, startApp, until, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';

type Customer = Row<typeof customers>;
type DocumentRow = Row<typeof documents>;

const INSPECTION_KEYS = [
  'createdAt',
  'id',
  'insurer',
  'inspectorName',
  'inspectorPhone',
  'location',
  'notes',
  'photos',
  'preferredDate',
  'preferredLocation',
  'preferredTime',
  'scheduledDate',
  'status',
  'vehicleLabel',
  'vehiclePlate',
].sort();

const DOCUMENT_KEYS = ['id', 'name', 'size', 'type', 'url'];

describe('inspections', () => {
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

  const asCustomer = async (customer: Customer) =>
    bearer(await customerToken({ keycloakId: customer.keycloakId, email: customer.email }));

  const photoIn = async (inspectionId: string, customer: Customer, slot: string) => {
    const document = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
    await testApp.db.insert(inspectionPhotos).values({ inspectionId, slot, documentId: document.id });
    return document;
  };

  const documentResponse = async (document: DocumentRow) => ({
    id: document.id,
    name: document.fileName,
    type: document.mimeType,
    size: document.sizeBytes,
    url: await testApp.storage.signedDownloadUrl(document.storageKey, document.fileName),
  });

  const stored = async (id: string) => {
    const [row] = await testApp.db.select().from(inspections).where(eq(inspections.id, id));
    return row;
  };

  describe('GET /inspections', () => {
    it('returns the known values of an inspection with its insurer and photos, and exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const inspection = await buildInspection(
        testApp.db,
        { customerId: customer.id, insurerId: insurer.id },
        {
          status: 'SCHEDULED',
          vehiclePlate: 'BAA 1234',
          vehicleLabel: '2019 Toyota Corolla',
          preferredDate: new Date('2026-11-02T08:30:00.123Z'),
          preferredTime: 'Morning',
          preferredLocation: 'Cairo Road, Lusaka',
          scheduledDate: new Date('2026-11-03T09:00:00.456Z'),
          inspectorName: 'Mwila Banda',
          inspectorPhone: '+260 97 000 0000',
          location: 'Insurer yard',
          notes: 'Side gate',
          createdAt: new Date('2026-10-01T12:00:00.789Z'),
        },
      );
      const { photo, document } = await buildInspectionPhoto(testApp.db, {
        inspectionId: inspection.id,
        uploader: { customerId: customer.id },
      });

      const response = await testApp.http.get('/api/v1/inspections').set(await asCustomer(customer)).expect(200);

      expect(response.body).toHaveLength(1);
      const [body] = response.body;
      expect(Object.keys(body).sort()).toEqual(INSPECTION_KEYS);
      expect(Object.keys(body.photos[0].document).sort()).toEqual(DOCUMENT_KEYS);
      expect(body).toEqual({
        id: inspection.id,
        status: 'Scheduled',
        insurer: insurer.name,
        vehiclePlate: 'BAA 1234',
        vehicleLabel: '2019 Toyota Corolla',
        preferredDate: '2026-11-02T08:30:00.123Z',
        preferredTime: 'Morning',
        preferredLocation: 'Cairo Road, Lusaka',
        scheduledDate: '2026-11-03T09:00:00.456Z',
        inspectorName: 'Mwila Banda',
        inspectorPhone: '+260 97 000 0000',
        location: 'Insurer yard',
        notes: 'Side gate',
        createdAt: '2026-10-01T12:00:00.789Z',
        photos: [
          {
            slot: photo.slot,
            document: {
              id: document.id,
              name: document.fileName,
              type: document.mimeType,
              size: document.sizeBytes,
              url: await testApp.storage.signedDownloadUrl(document.storageKey, document.fileName),
            },
          },
        ],
      });
    });

    it('lists an inspection’s photos in slot order', async () => {
      const customer = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: customer.id });
      const sidePhoto = await photoIn(inspection.id, customer, 'side');
      const rearPhoto = await photoIn(inspection.id, customer, 'rear');
      const frontPhoto = await photoIn(inspection.id, customer, 'front');

      const response = await testApp.http.get('/api/v1/inspections').set(await asCustomer(customer)).expect(200);

      expect(response.body[0].photos).toEqual([
        { slot: 'front', document: await documentResponse(frontPhoto) },
        { slot: 'rear', document: await documentResponse(rearPhoto) },
        { slot: 'side', document: await documentResponse(sidePhoto) },
      ]);
    });

    it('returns nulls and no photos for an inspection with no insurer or schedule', async () => {
      const customer = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: customer.id });

      const response = await testApp.http.get('/api/v1/inspections').set(await asCustomer(customer)).expect(200);

      expect(response.body).toEqual([
        {
          id: inspection.id,
          status: 'Requested',
          insurer: null,
          vehiclePlate: inspection.vehiclePlate,
          vehicleLabel: inspection.vehicleLabel,
          preferredDate: null,
          preferredTime: null,
          preferredLocation: null,
          scheduledDate: null,
          inspectorName: null,
          inspectorPhone: null,
          location: null,
          notes: null,
          createdAt: inspection.createdAt.toISOString(),
          photos: [],
        },
      ]);
    });

    it('lists only the customer’s own inspections, newest first', async () => {
      const customer = await buildCustomer(testApp.db);
      const other = await buildCustomer(testApp.db);
      const older = await buildInspection(testApp.db, { customerId: customer.id }, { createdAt: new Date('2026-01-01T00:00:00.000Z') });
      const newer = await buildInspection(testApp.db, { customerId: customer.id }, { createdAt: new Date('2026-02-01T00:00:00.000Z') });
      await buildInspection(testApp.db, { customerId: other.id });

      const response = await testApp.http.get('/api/v1/inspections').set(await asCustomer(customer)).expect(200);

      expect(response.body.map((inspection: { id: string }) => inspection.id)).toEqual([newer.id, older.id]);
    });
  });

  describe('POST /inspections', () => {
    it('records a trimmed request for an active insurer and answers 201 with exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/inspections')
        .set(await asCustomer(customer))
        .send({
          vehiclePlate: '  BAA 1234 ',
          vehicleLabel: ' 2019 Toyota Corolla ',
          insurerId: insurer.id,
          preferredDate: '2026-11-02T08:30:00.123Z',
          preferredTime: ' Morning ',
          preferredLocation: ' Cairo Road ',
          notes: ' Side gate ',
        })
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(INSPECTION_KEYS);
      expect(response.body.id).toMatch(/^INS-[0-9A-Z]+$/);
      const row = await stored(response.body.id);
      expect(row).toMatchObject({
        customerId: customer.id,
        insurerId: insurer.id,
        status: 'REQUESTED',
        vehiclePlate: 'BAA 1234',
        vehicleLabel: '2019 Toyota Corolla',
        preferredTime: 'Morning',
        preferredLocation: 'Cairo Road',
        notes: 'Side gate',
      });
      expect(response.body).toEqual({
        id: row.id,
        status: 'Requested',
        insurer: insurer.name,
        vehiclePlate: 'BAA 1234',
        vehicleLabel: '2019 Toyota Corolla',
        preferredDate: '2026-11-02T08:30:00.123Z',
        preferredTime: 'Morning',
        preferredLocation: 'Cairo Road',
        scheduledDate: null,
        inspectorName: null,
        inspectorPhone: null,
        location: null,
        notes: 'Side gate',
        createdAt: row.createdAt.toISOString(),
        photos: [],
      });
    });

    it('records a request without an insurer or preferences', async () => {
      const customer = await buildCustomer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/inspections')
        .set(await asCustomer(customer))
        .send({ vehiclePlate: 'BCD 777', vehicleLabel: 'Hilux' })
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'Requested',
        insurer: null,
        preferredDate: null,
        preferredTime: null,
        preferredLocation: null,
        notes: null,
        photos: [],
      });
      expect(await stored(response.body.id)).toMatchObject({ customerId: customer.id, insurerId: null });
    });

    it.each([
      ['an inactive insurer', 'INACTIVE' as const],
      ['a deleted insurer', 'DELETED' as const],
    ])('refuses %s with 404 and records nothing', async (_label, status) => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      await testApp.db.update(insurers).set({ status }).where(eq(insurers.id, insurer.id));

      const response = await testApp.http
        .post('/api/v1/inspections')
        .set(await asCustomer(customer))
        .send({ vehiclePlate: 'BAA 1234', vehicleLabel: 'Corolla', insurerId: insurer.id })
        .expect(404);

      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: `Insurer ${insurer.id} was not found.`,
        details: null,
      });
      expect(await testApp.db.select().from(inspections).where(eq(inspections.customerId, customer.id))).toEqual([]);
    });

    it('refuses with 404 when the insurer is deactivated while the request waits for it', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const headers = await asCustomer(customer);
      const holder = await side.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`UPDATE insurers SET status = 'INACTIVE' WHERE id = $1`, [insurer.id]);

        const request = testApp.http
          .post('/api/v1/inspections')
          .set(headers)
          .send({ vehiclePlate: 'BAA 1234', vehicleLabel: 'Corolla', insurerId: insurer.id })
          .then((response) => response);
        await until(async () => {
          const { rows } = await side.pool.query<{ count: string }>(
            `SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%"insurers"%'`,
          );
          return Number(rows[0].count) > 0;
        }, 'the request to wait for the insurer row');
        await holder.query('COMMIT');

        const response = await request;
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: `Insurer ${insurer.id} was not found.` });
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
      expect(await testApp.db.select().from(inspections).where(eq(inspections.customerId, customer.id))).toEqual([]);
    });

    it('refuses an unknown insurer with 404', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurerId = randomUUID();

      const response = await testApp.http
        .post('/api/v1/inspections')
        .set(await asCustomer(customer))
        .send({ vehiclePlate: 'BAA 1234', vehicleLabel: 'Corolla', insurerId })
        .expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: `Insurer ${insurerId} was not found.` });
    });
  });

  describe('PATCH /inspections/:id', () => {
    it('changes only the preferences sent, trimmed, and answers the whole inspection with its photos in slot order', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const inspection = await buildInspection(
        testApp.db,
        { customerId: customer.id, insurerId: insurer.id },
        {
          status: 'SCHEDULED',
          vehiclePlate: 'BAA 1234',
          vehicleLabel: '2019 Toyota Corolla',
          preferredDate: new Date('2026-11-02T08:30:00.123Z'),
          preferredTime: 'Morning',
          preferredLocation: 'Cairo Road',
          scheduledDate: new Date('2026-11-03T09:00:00.456Z'),
          inspectorName: 'Mwila Banda',
          inspectorPhone: '+260 97 000 0000',
          location: 'Insurer yard',
          notes: 'Side gate',
          createdAt: new Date('2026-10-01T12:00:00.789Z'),
        },
      );
      const rear = await photoIn(inspection.id, customer, 'rear');
      const front = await photoIn(inspection.id, customer, 'front');

      const response = await testApp.http
        .patch(`/api/v1/inspections/${inspection.id}`)
        .set(await asCustomer(customer))
        .send({ preferredTime: ' Afternoon ', notes: ' Front gate ' })
        .expect(200);

      expect(Object.keys(response.body).sort()).toEqual(INSPECTION_KEYS);
      for (const photo of response.body.photos) expect(Object.keys(photo.document).sort()).toEqual(DOCUMENT_KEYS);
      expect(response.body).toEqual({
        id: inspection.id,
        status: 'Scheduled',
        insurer: insurer.name,
        vehiclePlate: 'BAA 1234',
        vehicleLabel: '2019 Toyota Corolla',
        preferredDate: '2026-11-02T08:30:00.123Z',
        preferredTime: 'Afternoon',
        preferredLocation: 'Cairo Road',
        scheduledDate: '2026-11-03T09:00:00.456Z',
        inspectorName: 'Mwila Banda',
        inspectorPhone: '+260 97 000 0000',
        location: 'Insurer yard',
        notes: 'Front gate',
        createdAt: '2026-10-01T12:00:00.789Z',
        photos: [
          { slot: 'front', document: await documentResponse(front) },
          { slot: 'rear', document: await documentResponse(rear) },
        ],
      });
      expect(await stored(inspection.id)).toMatchObject({ preferredTime: 'Afternoon', notes: 'Front gate', preferredLocation: 'Cairo Road' });
    });

    it('changes the preferred date of an inspection with no insurer, and answers its nulls and no photos', async () => {
      const customer = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: customer.id }, { createdAt: new Date('2026-10-02T06:00:00.001Z') });

      const response = await testApp.http
        .patch(`/api/v1/inspections/${inspection.id}`)
        .set(await asCustomer(customer))
        .send({ preferredDate: '2026-12-01T07:00:00.250Z' })
        .expect(200);

      expect(response.body).toEqual({
        id: inspection.id,
        status: 'Requested',
        insurer: null,
        vehiclePlate: 'ABC 1234',
        vehicleLabel: 'Toyota Corolla 2019',
        preferredDate: '2026-12-01T07:00:00.250Z',
        preferredTime: null,
        preferredLocation: null,
        scheduledDate: null,
        inspectorName: null,
        inspectorPhone: null,
        location: null,
        notes: null,
        createdAt: '2026-10-02T06:00:00.001Z',
        photos: [],
      });
    });

    it.each<[InspectionStatus, string]>([
      ['INSPECTOR_ASSIGNED', 'inspector assigned'],
      ['IN_PROGRESS', 'in progress'],
      ['COMPLETED', 'completed'],
      ['REPORT_READY', 'report ready'],
      ['APPROVED', 'approved'],
      ['FAILED', 'failed'],
    ])('refuses a change once the inspection is %s with 409 and changes nothing', async (status, wording) => {
      const customer = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: customer.id }, { status, notes: 'Before' });

      const response = await testApp.http
        .patch(`/api/v1/inspections/${inspection.id}`)
        .set(await asCustomer(customer))
        .send({ notes: 'After' })
        .expect(409);

      expect(response.body).toEqual({
        code: 'INSPECTION_IN_PROGRESS',
        message: `This inspection is ${wording}. Contact your insurer to change it.`,
        details: null,
      });
      expect(await stored(inspection.id)).toMatchObject({ status, notes: 'Before' });
    });

    it('answers 404 for another customer’s inspection and changes nothing', async () => {
      const owner = await buildCustomer(testApp.db);
      const intruder = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: owner.id }, { notes: 'Owner’s' });

      const response = await testApp.http
        .patch(`/api/v1/inspections/${inspection.id}`)
        .set(await asCustomer(intruder))
        .send({ notes: 'Intruder’s' })
        .expect(404);

      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: `Inspection ${inspection.id} was not found.`,
        details: null,
      });
      expect(await stored(inspection.id)).toMatchObject({ notes: 'Owner’s' });
    });

    it('answers 404 for an unknown inspection', async () => {
      const customer = await buildCustomer(testApp.db);

      const response = await testApp.http
        .patch('/api/v1/inspections/INS-UNKNOWN')
        .set(await asCustomer(customer))
        .send({ notes: 'x' })
        .expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Inspection INS-UNKNOWN was not found.' });
    });

    it('refuses a change with 409 when the inspection is started while the change waits for it', async () => {
      const customer = await buildCustomer(testApp.db);
      const inspection = await buildInspection(testApp.db, { customerId: customer.id }, { notes: 'Before' });
      const headers = await asCustomer(customer);
      const holder = await side.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`UPDATE inspections SET status = 'IN_PROGRESS' WHERE id = $1`, [inspection.id]);

        const change = testApp.http.patch(`/api/v1/inspections/${inspection.id}`).set(headers).send({ notes: 'After' }).then((response) => response);
        await until(async () => {
          const { rows } = await side.pool.query<{ count: string }>(
            `SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%"inspections"%'`,
          );
          return Number(rows[0].count) > 0;
        }, 'the change to wait for the inspection row');
        await holder.query('COMMIT');

        const response = await change;
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'INSPECTION_IN_PROGRESS' });
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
      expect(await stored(inspection.id)).toMatchObject({ status: 'IN_PROGRESS', notes: 'Before' });
    });
  });

  describe('staff accounts', () => {
    it.each([
      ['GET', '/api/v1/inspections'],
      ['POST', '/api/v1/inspections'],
      ['PATCH', '/api/v1/inspections/INS-ANY'],
    ])('are refused %s %s with 403', async (method, path) => {
      const { staff } = await buildInsurer(testApp.db);
      const headers = bearer(await staffToken(staff, ['insurer_user']));
      const body = { vehiclePlate: 'BAA 1234', vehicleLabel: 'Corolla' };
      const call =
        method === 'GET'
          ? testApp.http.get(path)
          : method === 'POST'
            ? testApp.http.post(path).send(body)
            : testApp.http.patch(path).send({ notes: 'x' });

      const response = await call.set(headers).expect(403);

      expect(response.body).toEqual({
        code: 'FORBIDDEN',
        message: 'This endpoint is for customer accounts.',
        details: null,
      });
    });
  });
});
