import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { StorageService, type DocumentScope } from '../storage/storage.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { DocumentKind } from '../common/domain/enums.js';
import type { Env } from '../config/env.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsRepository, type DocumentRow } from './documents.repository.js';
import { fileTooLarge } from './upload-limits.js';

/** What the browser is allowed to upload, matching apps/web/src/lib/files.js. */
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export interface DocumentRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly repository: DocumentsRepository,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
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

    const key = this.storage.buildKey(scope, file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);

    const document = await this.repository.insert({
      kind,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey: key,
      // Lets a later upload of the same bytes be recognised, and proves the
      // stored object has not been altered.
      checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
      ...(principal.kind === 'customer'
        ? { uploadedByCustomerId: principal.id }
        : { uploadedByStaffId: principal.id }),
    });

    return this.toRecord(document);
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

  /** A document the principal is related to; any other answers as if it did not exist. */
  async recordFor(principal: Principal, documentId: string): Promise<DocumentRecord> {
    const document = await this.repository.findVisibleTo(principal, documentId);
    if (!document) throw ApiException.notFound('Document', documentId);
    return this.toRecord(document);
  }

  /** Confirms a document exists before it is attached to a quote or policy. */
  async requireExists(documentId: string): Promise<void> {
    const document = await this.repository.find(documentId);
    if (!document) throw ApiException.notFound('Document', documentId);
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

  private async toRecord(document: DocumentRow): Promise<DocumentRecord> {
    return {
      id: document.id,
      name: document.fileName,
      type: document.mimeType,
      size: document.sizeBytes,
      url: await this.storage.signedDownloadUrl(document.storageKey, document.fileName),
    };
  }
}
