import type { Principal } from '../common/auth/auth.types.js';
import type { DocumentKind } from '../common/domain/enums.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsService } from './documents.service.js';

const CUSTOMER: Principal = { kind: 'customer', id: 'customer-1', email: 'c@example.test' };
const STAFF: Principal = {
  kind: 'staff',
  id: 'staff-1',
  email: 's@example.test',
  role: 'INSURER_USER',
  insurerId: 'insurer-1',
};

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
  const service = new DocumentsService(repository as never, {} as never, {} as never);
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
  it('refuses a file over the limit with the same message the multipart limit gives', async () => {
    const limit = 3 * 1024 * 1024;
    const config = { get: () => limit };
    const service = new DocumentsService({} as never, {} as never, config as never);
    const file = { mimetype: 'application/pdf', size: limit + 1 } as Express.Multer.File;

    await expect(service.upload(file, 'CLAIM_ATTACHMENT', { kind: 'claim-attachment', claimNumber: 'x' } as never, CUSTOMER))
      .rejects.toMatchObject({ response: { code: 'FILE_TOO_LARGE', message: 'That file is larger than the 3 MB limit.' } });
  });
});

describe('record', () => {
  const row = { id: 'd', fileName: 'quote.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k/quote.pdf' };

  function serviceFinding(found: typeof row | undefined) {
    const reads: (Transaction | undefined)[] = [];
    const repository = {
      find: async (_id: string, tx?: Transaction) => {
        reads.push(tx);
        return found;
      },
    };
    const storage = { signedDownloadUrl: async (key: string) => `https://signed/${key}` };
    return { service: new DocumentsService(repository as never, storage as never, {} as never), reads };
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
});
