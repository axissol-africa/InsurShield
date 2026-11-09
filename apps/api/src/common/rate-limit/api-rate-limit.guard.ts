import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/database.module.js';
import { authRateLimits } from '../../db/schema.js';
import { describeDatabaseError } from '../../db/errors.js';
import { ApiException } from '../errors/api.exception.js';

export const API_RATE_LIMIT = 'apiRateLimit';

export interface ApiRateLimitPolicy {
  /** A stable name prevents unrelated endpoints consuming each other's limit. */
  bucket: string;
  limit: number;
  windowMs: number;
}

/** Marks an HTTP endpoint with its own address-based rate-limit policy. */
export const ApiRateLimit = (policy: ApiRateLimitPolicy) => SetMetadata(API_RATE_LIMIT, policy);

export const API_LIMITS = {
  /** Public information and vehicle lookups: enough for normal browsing, not scraping. */
  publicRead: { bucket: 'public-read', limit: 30, windowMs: 60_000 },
  /** A discount code is a secret and should not be guessed repeatedly. */
  ncdValidation: { bucket: 'ncd-validation', limit: 8, windowMs: 60_000 },
  /** Uploads are resource-intensive even before storage receives the bytes. */
  upload: { bucket: 'upload', limit: 12, windowMs: 5 * 60_000 },
  /** A download link is short-lived, so harvesting them has to be slow too. */
  download: { bucket: 'download', limit: 60, windowMs: 5 * 60_000 },
  /** A list response carries a link per document, so looping over one harvests in bulk. */
  bulkRead: { bucket: 'bulk-read', limit: 60, windowMs: 5 * 60_000 },
  /** Customer submissions should tolerate retries but stop accidental loops. */
  customerWrite: { bucket: 'customer-write', limit: 20, windowMs: 5 * 60_000 },
} as const satisfies Record<string, ApiRateLimitPolicy>;

const logger = new Logger('ApiRateLimit');

/**
 * Uses the database-backed Better Auth rate-limit storage with an `api|`
 * namespace. The upsert is one statement, so concurrent requests cannot both
 * pass the final available slot.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get('API_RATE_LIMIT', { infer: true }) === 'off') return true;

    const policy = this.reflector.getAllAndOverride<ApiRateLimitPolicy>(API_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return true;

    const request = context.switchToHttp().getRequest<Request>();
    // Express calculates `ip` after `TRUST_PROXY_HOPS` has been applied in
    // configureApp. A client header cannot choose this value when no proxy is
    // trusted, and a missing address shares only the deliberately conservative
    // fallback bucket.
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    const admitted = await this.admit(policy, address, Date.now());
    if (!admitted) {
      throw new ApiException(
        'RATE_LIMITED',
        'Too many requests. Please wait a moment and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: Math.max(1, Math.ceil(policy.windowMs / 1_000)) },
      );
    }
    return true;
  }

  private async admit(policy: ApiRateLimitPolicy, address: string, now: number): Promise<boolean> {
    const key = `api|${policy.bucket}|${address}`;
    const windowStart = now - policy.windowMs;
    try {
      const result = await this.db.execute<{ count: number }>(sql`
        INSERT INTO ${authRateLimits} ("id", "key", "count", "lastRequest")
        VALUES (${randomUUID()}, ${key}, 1, ${now})
        ON CONFLICT ("key") DO UPDATE
          SET "count" = CASE
                WHEN "auth_rate_limits"."lastRequest" <= ${windowStart} THEN 1
                ELSE "auth_rate_limits"."count" + 1
              END,
              "lastRequest" = ${now}
        RETURNING "count"
      `);
      return result.rows[0].count <= policy.limit;
    } catch (error) {
      // A rate-limit outage must not silently permit unlimited submissions.
      logger.error('Could not enforce an API rate limit.', describeDatabaseError(error));
      throw new ApiException(
        'RATE_LIMIT_UNAVAILABLE',
        'The service is busy right now. Please try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
