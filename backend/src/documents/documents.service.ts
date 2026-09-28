import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, type DocumentScope } from '../storage/storage.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DocumentKind } from '../generated/prisma/enums.js';
import type { Env } from '../config/env.js';
import type { Principal } from '../common/auth/auth.types.js';

/** What the browser is allowed to upload, matching frontend/src/lib/files.js. */
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
    private readonly prisma: PrismaService,
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
    if (file.size > limit) {
      throw new ApiException(
        'FILE_TOO_LARGE',
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${limit / 1024 / 1024} MB.`,
      );
    }

    const key = this.storage.buildKey(scope, file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);

    const document = await this.prisma.document.create({
      data: {
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
      },
    });

    return this.toRecord(document.id, file.originalname, file.mimetype, file.size, key);
  }

  /** Re-signs a stored document so the client always gets a fresh link. */
  async record(documentId: string): Promise<DocumentRecord> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw ApiException.notFound('Document', documentId);

    return this.toRecord(
      document.id,
      document.fileName,
      document.mimeType,
      document.sizeBytes,
      document.storageKey,
    );
  }

  /** Confirms a document exists before it is attached to a quote or policy. */
  async requireExists(documentId: string): Promise<void> {
    const exists = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true },
    });
    if (!exists) throw ApiException.notFound('Document', documentId);
  }

  private async toRecord(
    id: string,
    name: string,
    type: string,
    size: number,
    storageKey: string,
  ): Promise<DocumentRecord> {
    return { id, name, type, size, url: await this.storage.signedDownloadUrl(storageKey, name) };
  }
}
