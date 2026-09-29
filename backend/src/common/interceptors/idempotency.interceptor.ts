import { createHash } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiException } from '../errors/api.exception.js';

/** How long a stored response stays replayable. */
const RETENTION_HOURS = 24;

/**
 * Replays the stored response when a client retries a POST with the same
 * `Idempotency-Key`, so a dropped connection or an impatient tap cannot take a
 * second payment or issue a duplicate policy.
 *
 * The key is scoped to the endpoint and to a hash of the request body: reusing
 * one key for a different payload is a client bug and is rejected rather than
 * silently returning the wrong record.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.header('Idempotency-Key');

    if (!key) {
      throw new ApiException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'This request must carry an Idempotency-Key header.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    return from(this.prisma.idempotencyRecord.findUnique({ where: { key } })).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
            throw ApiException.conflict(
              'IDEMPOTENCY_KEY_REUSED',
              'This idempotency key was already used for a different request.',
            );
          }
          if (existing.responseBody === null) {
            // A concurrent attempt is still running; a retry now would double up.
            throw ApiException.conflict(
              'REQUEST_IN_PROGRESS',
              'An identical request is still being processed. Try again shortly.',
            );
          }
          this.logger.log(`Replaying ${endpoint} for key ${key}`);
          return of(existing.responseBody);
        }

        const expiresAt = new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000);
        // Claim the key first. The unique constraint makes this the point where
        // two simultaneous retries are serialised.
        return from(
          this.prisma.idempotencyRecord.create({
            data: { key, endpoint, requestHash, expiresAt },
          }),
        ).pipe(
          switchMap(() => next.handle()),
          tap({
            next: (body) => {
              void this.prisma.idempotencyRecord
                .update({
                  where: { key },
                  data: { responseStatus: HttpStatus.CREATED, responseBody: body as never },
                })
                .catch((error: unknown) => this.logger.error(`Storing ${key} failed`, error));
            },
            error: () => {
              // A failed attempt must not block a corrected retry.
              void this.prisma.idempotencyRecord
                .delete({ where: { key } })
                .catch(() => undefined);
            },
          }),
        );
      }),
    );
  }
}
