import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { StorageService, type DocumentScope } from '../storage/storage.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { DocumentKind } from '../common/domain/enums.js';
import type { Env } from '../config/env.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsRepository, type DocumentRow } from './documents.repository.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { MALWARE_SCANNER, type MalwareScanner } from '../scanning/scanner.port.js';
import { retentionClassOf } from './domain/retention.js';
import { fileTooLarge } from './upload-limits.js';

/** What the browser is allowed to upload, matching apps/web/src/lib/files.js. */
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function hasExpectedBytes(mimeType: string, bytes: Buffer): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    default:
      return false;
  }
}

export interface DocumentRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  /**
   * Absent when the document has not been found clean. The record still
   * describes the file, so a list or detail response keeps its shape; only the
   * link is withheld.
   */
  url?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentsRepository,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  /**
   * Stores the bytes in private object storage and keeps only metadata in the
   * database. The returned record carries a short-lived signed URL, never a
   * bucket path.
   */
  async upload(
    file: Express.Multer.File,
    kind: DocumentKind,
    scope: DocumentScope,
    principal: Principal,
  ): Promise<DocumentRecord> {
    if (!file) throw new ApiException('FILE_REQUIRED', 'Attach a file to upload.');

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new ApiException(
        'UNSUPPORTED_FILE_TYPE',
        'Upload the document as a PDF, JPG or PNG.',
      );
    }

    const limit = this.config.get('MAX_UPLOAD_BYTES', { infer: true });
    if (file.size > limit) throw fileTooLarge(limit);

    if (!hasExpectedBytes(file.mimetype, file.buffer)) {
      throw new ApiException(
        'UNSUPPORTED_FILE_CONTENT',
        'The file contents do not match the selected PDF, JPG or PNG format.',
      );
    }

    // Scanned before the bytes reach the bucket and before any transaction is
    // opened: infected bytes are never stored, and no transaction waits on a
    // network call.
    const verdict = await this.scanner.scan(file.buffer);
    if (verdict.result !== 'clean') {
      if (verdict.result === 'unavailable') {
        // The customer is told only to try again, and the audit entry records
        // no reason, so this log is the only place an operator can tell a
        // credential failure from a timeout while uploads refuse platform-wide.
        this.logger.warn(`Malware scan unavailable: ${verdict.reason}`);
      }
      await this.recordRefusal(kind, principal, verdict.result === 'infected' ? verdict.signature : null);
      throw verdict.result === 'infected'
        ? new ApiException(
            'FILE_REJECTED',
            'That file was refused by the security scan. Upload a different file.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          )
        : new ApiException(
            'FILE_SCAN_UNAVAILABLE',
            'Files cannot be checked for viruses right now. Please try again shortly.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
    }

    const scannedAt = new Date();
    const key = this.storage.buildKey(scope, file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);

    const document = await this.storeMetadata(key, file, kind, principal, scannedAt);

    return this.toRecord(document);
  }

  /**
   * The object is already in the bucket by this point, so a failed insert would
   * leave it with nothing referencing it. Deleting it here keeps storage and
   * the database in step; a failed delete does not mask the original error.
   *
   * A rejected promise does not prove the row is absent: a connection lost
   * during COMMIT reads the same way as a refused insert, and the server may
   * have committed. Deleting then would strand a row pointing at bytes that no
   * longer exist, which is worse than leaving an object nothing references, so
   * the row is checked before anything is removed.
   */
  private async storeMetadata(
    key: string,
    file: Express.Multer.File,
    kind: DocumentKind,
    principal: Principal,
    scannedAt: Date,
  ): Promise<DocumentRow> {
    try {
      return await this.documentRow(key, file, kind, principal, scannedAt);
    } catch (error) {
      if (!(await this.repository.storedUnder(key).catch(() => true))) {
        await this.storage.delete(key).catch((failure: unknown) => {
          this.logger.error(`Could not remove the stored object of a failed upload: ${String(failure)}`);
        });
      }
      throw error;
    }
  }

  private async documentRow(
    key: string,
    file: Express.Multer.File,
    kind: DocumentKind,
    principal: Principal,
    scannedAt: Date,
  ): Promise<DocumentRow> {
    return this.repository.transaction(async (tx) => {
      const stored = await this.repository.insert(tx, {
        kind,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey: key,
        // Lets a later upload of the same bytes be recognised, and proves the
        // stored object has not been altered.
        checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
        scanStatus: 'CLEAN',
        scannedAt,
        scannerName: this.scanner.name,
        retentionClass: retentionClassOf(kind),
        ...(principal.kind === 'customer'
          ? { uploadedByCustomerId: principal.id }
          : { uploadedByStaffId: principal.id }),
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'document.uploaded',
        entityType: 'DOCUMENT',
        entityId: stored.id,
        after: {
          kind: stored.kind,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          scanStatus: stored.scanStatus,
          scannerName: stored.scannerName,
          retentionClass: stored.retentionClass,
        },
        note: 'Document uploaded for a later workflow attachment.',
        correlationId: stored.id,
      });
      return stored;
    });
  }

  /**
   * Re-signs a stored document so the client always gets a fresh link. For
   * callers that have already checked the principal may see the parent record.
   * Inside a transaction pass `tx`, so the read does not wait for a second connection.
   */
  async record(documentId: string, tx?: Transaction): Promise<DocumentRecord> {
    const document = await this.repository.find(documentId, tx);
    if (!document) throw ApiException.notFound('Document', documentId);
    return this.toRecord(document);
  }

  /**
   * A document the principal is related to; any other answers as if it did not
   * exist. This is the only route that hands a link straight to a caller, so it
   * is the one that records who read what. Links embedded in a workflow
   * response come from `record` as part of an operation already audited.
   */
  async recordFor(principal: Principal, documentId: string): Promise<DocumentRecord> {
    const document = await this.repository.findVisibleTo(principal, documentId);
    if (!document) throw ApiException.notFound('Document', documentId);
    // Asking for a document outright is refused outright. An embedded record
    // only loses its link, so one unscanned file cannot break a whole page.
    if (document.scanStatus !== 'CLEAN') {
      throw new ApiException(
        'DOCUMENT_NOT_AVAILABLE',
        'That document is not available for download.',
        HttpStatus.CONFLICT,
      );
    }
    const record = await this.toRecord(document);
    await this.repository.transaction((tx) =>
      this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'document.downloaded',
        entityType: 'DOCUMENT',
        entityId: document.id,
        after: { kind: document.kind },
        note: 'Download link issued.',
        correlationId: document.id,
      }),
    );
    return record;
  }

  /**
   * Records an upload the scanner refused. Nothing was stored, so the audit
   * entry is the only trace; it names the kind and the signature, never the
   * file name or its bytes.
   */
  private async recordRefusal(
    kind: DocumentKind,
    principal: Principal,
    signature: string | null,
  ): Promise<void> {
    await this.repository.transaction((tx) =>
      this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'document.rejected',
        // The attempt, not a document: nothing was stored to point at.
        entityType: 'DOCUMENT_UPLOAD',
        entityId: randomUUID(),
        after: { kind, signature },
        note: signature
          ? 'Upload refused: the security scan reported a detection.'
          : 'Upload refused: the security scanner was unavailable.',
      }),
    );
  }

  /**
   * Refuses documents the principal did not upload, of another kind, or already
   * attached anywhere. The rows stay locked until `tx` ends, so the caller's
   * attach cannot interleave with another attach of the same document.
   */
  async assertAttachable(
    tx: Transaction,
    principal: Principal,
    documentIds: string[],
    kind: DocumentKind,
  ): Promise<void> {
    // PostgreSQL reads a UUID in any letter case as the same id.
    if (new Set(documentIds.map((id) => id.toLowerCase())).size !== documentIds.length) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Each document can be attached only once.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (documentIds.length === 0) return;

    const locked = await this.repository.lockForAttach(tx, documentIds);
    // A separate statement after the lock, so it sees an attach that committed while this one waited.
    const referenced = await this.repository.referencedIds(tx, documentIds);
    const attachable = locked.filter(
      (document) =>
        document.kind === kind &&
        !referenced.has(document.id) &&
        (principal.kind === 'customer'
          ? document.uploadedByCustomerId === principal.id
          : document.uploadedByStaffId === principal.id),
    );
    if (attachable.length !== documentIds.length) {
      throw ApiException.conflict(
        'DOCUMENT_NOT_ATTACHABLE',
        'That document cannot be attached here. Upload the file again and attach the new upload.',
      );
    }
  }

  /**
   * Verifies a customer-owned document without reserving it for a single parent.
   * A White Book can legitimately follow the same vehicle into a later requote;
   * quotations, certificates and inspection evidence remain single-attachment.
   */
  async assertOwnedOfKind(
    tx: Transaction,
    principal: Principal,
    documentId: string,
    kind: DocumentKind,
  ): Promise<void> {
    const [document] = await this.repository.lockForAttach(tx, [documentId]);
    const owned =
      document &&
      document.kind === kind &&
      (principal.kind === 'customer'
        ? document.uploadedByCustomerId === principal.id
        : document.uploadedByStaffId === principal.id);
    if (!owned) {
      throw ApiException.conflict(
        'DOCUMENT_NOT_ATTACHABLE',
        'That document cannot be attached here. Upload the file again and attach the new upload.',
      );
    }
  }

  /**
   * The single point a download link is signed, so a document that has not been
   * found clean is never linked anywhere, staff included.
   */
  private async toRecord(document: DocumentRow): Promise<DocumentRecord> {
    const described: DocumentRecord = {
      id: document.id,
      name: document.fileName,
      type: document.mimeType,
      size: document.sizeBytes,
    };
    if (document.scanStatus !== 'CLEAN') return described;
    return {
      ...described,
      url: await this.storage.signedDownloadUrl(document.storageKey, document.fileName),
    };
  }
}
