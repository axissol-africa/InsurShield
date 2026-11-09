import { vi } from 'vitest';
import type { Principal } from '../common/auth/auth.types.js';
import type { DocumentKind } from '../common/domain/enums.js';
import type { Transaction } from '../db/database.module.js';
import type { ScanVerdict } from '../scanning/scanner.port.js';
import { DocumentsService } from './documents.service.js';

const CUSTOMER: Principal = { kind: 'customer', id: 'customer-1', email: 'c@example.test' };
const STAFF: Principal = {
  kind: 'staff',
  id: 'staff-1',
  email: 's@example.test',
  role: 'INSURER_USER',
  insurerId: 'insurer-1',
};

const audit = { write: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  audit.write.mockClear();
});

interface StoredDocument {
  id: string;
  kind: DocumentKind;
  uploadedByCustomerId: string | null;
  uploadedByStaffId: string | null;
}

function serviceWith(stored: StoredDocument[], referenced: string[] = []) {
  const calls: string[] = [];
  const repository = {
    lockForAttach: async (_tx: Transaction, ids: string[]) => {
      calls.push('lock');
      return stored.filter((document) => ids.includes(document.id));
    },
    referencedIds: async () => {
      calls.push('referenced');
      return new Set(referenced);
    },
  };
  const service = new DocumentsService(repository as never, {} as never, {} as never, audit as never, {} as never);
  const attach = (principal: Principal, ids: string[], kind: DocumentKind) =>
    service.assertAttachable({} as Transaction, principal, ids, kind);
  return { attach, calls };
}

const own = (id: string, kind: DocumentKind = 'CLAIM_ATTACHMENT'): StoredDocument => ({
  id,
  kind,
  uploadedByCustomerId: CUSTOMER.id,
  uploadedByStaffId: null,
});

describe('assertAttachable', () => {
  it('accepts fresh documents of the right kind that the principal uploaded', async () => {
    const { attach, calls } = serviceWith([own('a'), own('b')]);

    await expect(attach(CUSTOMER, ['a', 'b'], 'CLAIM_ATTACHMENT')).resolves.toBeUndefined();
    expect(calls).toEqual(['lock', 'referenced']);
  });

  it('accepts a staff upload for the staff member who uploaded it', async () => {
    const { attach } = serviceWith([
      { id: 'c', kind: 'CERTIFICATE', uploadedByCustomerId: null, uploadedByStaffId: STAFF.id },
    ]);

    await expect(attach(STAFF, ['c'], 'CERTIFICATE')).resolves.toBeUndefined();
  });

  it('refuses a repeated id with 400 before locking or checking anything', async () => {
    const { attach, calls } = serviceWith([own('a')]);

    await expect(attach(CUSTOMER, ['a', 'a'], 'CLAIM_ATTACHMENT')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(calls).toEqual([]);
  });

  it('refuses one id repeated in another letter case with 400 before locking', async () => {
    const id = '7f1c2b9e-5d4a-4c3b-9a8e-1f2d3c4b5a6e';
    const { attach, calls } = serviceWith([own(id)]);

    await expect(attach(CUSTOMER, [id, id.toUpperCase()], 'CLAIM_ATTACHMENT')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['uploaded by another customer', [{ ...own('a'), uploadedByCustomerId: 'customer-2' }], [], CUSTOMER],
    ['uploaded by staff, attached by a customer', [{ ...own('a'), uploadedByCustomerId: null, uploadedByStaffId: CUSTOMER.id }], [], CUSTOMER],
    ['uploaded by a customer with the same id as the staff member', [{ ...own('a'), uploadedByCustomerId: STAFF.id }], [], STAFF],
    ['of another kind', [own('a', 'CERTIFICATE')], [], CUSTOMER],
    ['already attached', [own('a')], ['a'], CUSTOMER],
    ['missing', [], [], CUSTOMER],
  ] as const)('refuses a document %s with 409 DOCUMENT_NOT_ATTACHABLE', async (_case, stored, referenced, principal) => {
    const { attach } = serviceWith([...stored], [...referenced]);

    await expect(attach(principal, ['a'], 'CLAIM_ATTACHMENT')).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_ATTACHABLE',
      status: 409,
    });
  });

  it('refuses the whole request when one of several documents is not attachable', async () => {
    const { attach } = serviceWith([own('a'), own('b', 'QUOTATION')]);

    await expect(attach(CUSTOMER, ['a', 'b'], 'CLAIM_ATTACHMENT')).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_ATTACHABLE',
    });
  });

  it('does nothing for an empty list', async () => {
    const { attach, calls } = serviceWith([]);

    await expect(attach(CUSTOMER, [], 'CLAIM_ATTACHMENT')).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('upload', () => {
  const file = (mimetype: string, buffer: Buffer) =>
    ({ originalname: 'evidence', mimetype, size: buffer.length, buffer }) as Express.Multer.File;

  function uploadService(verdict: ScanVerdict = { result: 'clean' }) {
    const repository = {
      transaction: (work: (tx: Transaction) => Promise<unknown>) => work({} as Transaction),
      insert: vi.fn().mockResolvedValue({ id: 'doc-1', kind: 'CLAIM_ATTACHMENT', fileName: 'evidence', mimeType: 'application/pdf', sizeBytes: 5, storageKey: 'documents/evidence', scanStatus: 'CLEAN', scannerName: 'stand-in', retentionClass: 'CLAIM_EVIDENCE' }),
      storedUnder: vi.fn().mockResolvedValue(false),
    };
    const storage = {
      buildKey: vi.fn().mockReturnValue('documents/evidence'),
      put: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      signedDownloadUrl: vi.fn().mockResolvedValue('https://signed/doc-1'),
    };
    const config = { get: () => 3 * 1024 * 1024 };
    const scanner = { name: 'stand-in', scan: vi.fn().mockResolvedValue(verdict) };
    const service = new DocumentsService(repository as never, storage as never, config as never, audit as never, scanner as never);
    return { service, repository, storage, scanner };
  }

  it.each([
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ])('stores a genuine %s upload', async (mimetype, buffer) => {
    const { service, repository, storage } = uploadService();

    await expect(service.upload(file(mimetype, buffer), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .resolves.toMatchObject({ id: 'doc-1' });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(repository.insert).toHaveBeenCalledOnce();
  });

  it.each([
    ['application/pdf', Buffer.from('not actually a PDF')],
    ['image/jpeg', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['image/png', Buffer.from([0xff, 0xd8, 0xff])],
  ])('refuses spoofed %s bytes before storage or database writes', async (mimetype, buffer) => {
    const { service, repository, storage } = uploadService();

    await expect(service.upload(file(mimetype, buffer), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_CONTENT', status: 400 });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('stores nothing when the scanner reports a detection, and records the refusal', async () => {
    const { service, repository, storage, scanner } = uploadService({ result: 'infected', signature: 'EICAR-Test-File' });

    await expect(service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toMatchObject({ code: 'FILE_REJECTED', status: 422 });
    expect(scanner.scan).toHaveBeenCalledOnce();
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'document.rejected',
      after: { kind: 'CLAIM_ATTACHMENT', signature: 'EICAR-Test-File' },
    }));
  });

  it('fails closed when the scanner cannot answer, so nothing unscanned is stored', async () => {
    const { service, repository, storage } = uploadService({ result: 'unavailable', reason: 'connect ECONNREFUSED' });

    await expect(service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toMatchObject({ code: 'FILE_SCAN_UNAVAILABLE', status: 503 });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('removes the stored object when the row it would belong to was never written', async () => {
    const { service, repository, storage } = uploadService();
    const refused = new Error('insert refused');
    repository.insert.mockRejectedValueOnce(refused);

    await expect(service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toBe(refused);
    expect(repository.storedUnder).toHaveBeenCalledWith('documents/evidence');
    expect(storage.delete).toHaveBeenCalledWith('documents/evidence');
  });

  it.each([
    ['a row already claims the object', false, true],
    ['the check itself cannot answer', true, false],
  ])('keeps the stored object when %s', async (_case, checkThrows, stored) => {
    const { service, repository, storage } = uploadService();
    repository.insert.mockRejectedValueOnce(new Error('connection terminated during COMMIT'));
    repository.storedUnder = checkThrows
      ? vi.fn().mockRejectedValue(new Error('no connection'))
      : vi.fn().mockResolvedValue(stored);

    await expect(service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toThrow('connection terminated during COMMIT');
    // Deleting here would strand a committed row pointing at bytes that are gone.
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('keeps the reason for an unavailable scanner out of the refusal and the trail', async () => {
    const { service } = uploadService({ result: 'unavailable', reason: 'connect ECONNREFUSED 10.0.0.4:3310' });

    await expect(service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER))
      .rejects.toMatchObject({ response: { message: 'Files cannot be checked for viruses right now. Please try again shortly.' } });
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain('10.0.0.4');
  });

  it('records the scan provenance and retention class it stores', async () => {
    const { service, repository } = uploadService();

    await service.upload(file('application/pdf', Buffer.from('%PDF-1.7')), 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' }, CUSTOMER);

    expect(repository.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scanStatus: 'CLEAN',
      scannerName: 'stand-in',
      retentionClass: 'CLAIM_EVIDENCE',
      scannedAt: expect.any(Date),
    }));
  });

  it('refuses a file over the limit with the same message the multipart limit gives', async () => {
    const limit = 3 * 1024 * 1024;
    const config = { get: () => limit };
    const service = new DocumentsService({} as never, {} as never, config as never, audit as never, {} as never);
    const file = { mimetype: 'application/pdf', size: limit + 1 } as Express.Multer.File;

    await expect(service.upload(file, 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' } as never, CUSTOMER))
      .rejects.toMatchObject({ response: { code: 'FILE_TOO_LARGE', message: 'That file is larger than the 3 MB limit.' } });
  });
});

describe('record', () => {
  const row = { id: 'd', fileName: 'quote.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k/quote.pdf', scanStatus: 'CLEAN' };
  const unscanned = { ...row, scanStatus: 'UNSCANNED' };

  function serviceFinding(found: typeof row | undefined) {
    const reads: (Transaction | undefined)[] = [];
    const repository = {
      find: async (_id: string, tx?: Transaction) => {
        reads.push(tx);
        return found;
      },
    };
    const storage = { signedDownloadUrl: async (key: string) => `https://signed/${key}` };
    return { service: new DocumentsService(repository as never, storage as never, {} as never, audit as never, {} as never), reads };
  }

  it('reads the document through the given transaction and signs a link', async () => {
    const { service, reads } = serviceFinding(row);
    const tx = {} as Transaction;

    await expect(service.record('d', tx)).resolves.toEqual({
      id: 'd',
      name: 'quote.pdf',
      type: 'application/pdf',
      size: 10,
      url: 'https://signed/k/quote.pdf',
    });
    expect(reads).toEqual([tx]);
  });

  it('reads through the pool when no transaction is given', async () => {
    const { service, reads } = serviceFinding(row);

    await service.record('d');

    expect(reads).toEqual([undefined]);
  });

  it('answers 404 for a missing document', async () => {
    const { service } = serviceFinding(undefined);

    await expect(service.record('d', {} as Transaction)).rejects.toMatchObject({ status: 404 });
  });

  it('describes a document that has not been found clean, without signing a link for it', async () => {
    const { service } = serviceFinding(unscanned);

    const record = await service.record('d');

    expect(record).toEqual({ id: 'd', name: 'quote.pdf', type: 'application/pdf', size: 10 });
  });
});
