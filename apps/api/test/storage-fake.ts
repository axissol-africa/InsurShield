import { randomUUID } from 'node:crypto';
import type { DocumentScope, StorageService } from '../src/storage/storage.service.js';

type PublicMembers<T> = { [K in keyof T]: T[K] };

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export const FAKE_STORAGE_ORIGIN = 'https://storage.invalid';

/** An in-memory bucket. `startApp` binds it in place of `StorageService` with `overrideProvider`. */
export class StorageFake implements PublicMembers<StorageService> {
  readonly objects = new Map<string, StoredObject>();
  reachable = true;

  async onModuleInit(): Promise<void> {}

  buildKey(scope: DocumentScope, fileName: string): string {
    return `${scope.kind}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async signedDownloadUrl(key: string, fileName?: string): Promise<string> {
    const url = new URL(`/${encodeURIComponent(key)}`, FAKE_STORAGE_ORIGIN);
    if (fileName) url.searchParams.set('download', fileName);
    return url.toString();
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async isReachable(): Promise<boolean> {
    return this.reachable;
  }
}
