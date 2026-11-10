import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ApiException } from '../errors/api.exception.js';
import { DATABASE, type Database, type Transaction } from '../../db/database.module.js';
import { idempotencyRecords } from '../../db/schema.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

/**
 * Makes one customer command safe to retry after a lost response.
 *
 * A record and its side effect are committed in one database transaction. A
 * key is scoped to both the authenticated caller and the endpoint, so a key
 * from one customer can never replay another customer's result.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async execute<T>(
    callerId: string,
    endpoint: string,
    key: string,
    request: unknown,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = hashRequest(request);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECORD_TTL_MS);

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(idempotencyRecords)
        .values({ callerId, endpoint, key, requestHash, expiresAt })
        .onConflictDoNothing({
          target: [idempotencyRecords.callerId, idempotencyRecords.endpoint, idempotencyRecords.key],
        })
        .returning({ key: idempotencyRecords.key });

      if (inserted.length === 0) {
        const [stored] = await tx
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.callerId, callerId),
              eq(idempotencyRecords.endpoint, endpoint),
              eq(idempotencyRecords.key, key),
            ),
          );

        // An expired record is not a replay. `expiresAt` was written from the
        // first release and never read, so a day-old key still replayed its
        // answer; the purge that deletes these arrives with this change, and a
        // key that outlived its window must stop replaying whether or not the
        // purge has reached it yet. Taken over rather than deleted, so a
        // concurrent caller cannot slip between the delete and the insert.
        if (stored && stored.expiresAt <= now) {
          await tx
            .update(idempotencyRecords)
            .set({ requestHash, expiresAt, responseStatus: null, responseBody: null, createdAt: now })
            .where(
              and(
                eq(idempotencyRecords.callerId, callerId),
                eq(idempotencyRecords.endpoint, endpoint),
                eq(idempotencyRecords.key, key),
              ),
            );
          const value = await work(tx);
          await tx
            .update(idempotencyRecords)
            .set({ responseStatus: 201, responseBody: value })
            .where(
              and(
                eq(idempotencyRecords.callerId, callerId),
                eq(idempotencyRecords.endpoint, endpoint),
                eq(idempotencyRecords.key, key),
              ),
            );
          return { value, replayed: false };
        }

        if (!stored) {
          throw ApiException.conflict('IDEMPOTENCY_RETRY', 'Please retry this request.');
        }
        if (stored.requestHash !== requestHash) {
          throw ApiException.conflict(
            'IDEMPOTENCY_KEY_REUSED',
            'This request key was already used for different details. Start the action again.',
          );
        }
        if (stored.responseBody === null || stored.responseStatus === null) {
          throw ApiException.conflict('IDEMPOTENCY_IN_PROGRESS', 'This request is still being processed. Please retry shortly.');
        }

        return { value: stored.responseBody as T, replayed: true };
      }

      const value = await work(tx);
      await tx
        .update(idempotencyRecords)
        .set({ responseStatus: 201, responseBody: value })
        .where(
          and(
            eq(idempotencyRecords.callerId, callerId),
            eq(idempotencyRecords.endpoint, endpoint),
            eq(idempotencyRecords.key, key),
          ),
        );
      return { value, replayed: false };
    });
  }
}

/** Missing keys preserve the old endpoint behaviour but cannot be replayed. */
export function idempotencyKey(header: string | undefined): string {
  if (header === undefined) return randomUUID();
  const key = header.trim();
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiException(
      'VALIDATION_FAILED',
      `The request key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters long.`,
    );
  }
  return key;
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** JSON has no defined object-key ordering, so equal request bodies hash alike. */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
