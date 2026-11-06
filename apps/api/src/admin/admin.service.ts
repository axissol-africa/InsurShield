import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { sumToKwacha } from '../common/money.js';
import { AdminRepository } from './admin.repository.js';
import { toAuditLogResponse, toCustomerLookupResponse, toOverviewResponse, toRecentPolicyResponse } from './dto/admin-response.dto.js';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Platform-wide figures for the administrator console.
 *
 * Every number here is counted from the database. Nothing is estimated or
 * padded: an empty platform reports zeros, because a console that invents
 * plausible figures is worse than one that admits it has no data yet.
 */
@Injectable()
export class AdminService {
  constructor(private readonly admin: AdminRepository) {}

  async overview() {
    const now = new Date();
    const counts = await this.admin.overview(now, new Date(now.getTime() + 30 * DAY_MS));
    return toOverviewResponse(counts);
  }

  /** Premium confirmed per Lusaka calendar month for the last `months`, oldest first, empty months included. */
  async premiumByMonth(months = 12) {
    const buckets = await this.admin.premiumByMonth(new Date(), months);
    return buckets.map(({ month, total }) => ({ month, total: sumToKwacha(total) }));
  }

  /** Most recent policies across every insurer. */
  async recentPolicies(limit = 8) {
    return (await this.admin.recentPolicies(limit)).map(toRecentPolicyResponse);
  }

  /**
   * Customer lookup for support. Matches an exact email or phone rather than a
   * partial one, so the console cannot be used to enumerate the customer base.
   */
  async findCustomer(query: string) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 3) {
      throw new ApiException('QUERY_TOO_SHORT', 'Enter the full email address or mobile number.');
    }
    const customer = await this.admin.findCustomer(needle, query.trim());
    if (!customer) throw ApiException.notFound('Customer account');
    return toCustomerLookupResponse(customer, await this.admin.latestConsent(customer.id));
  }

  /**
   * Cursor pagination keeps long platform histories responsive without making
   * the ordering depend on a mutable page offset.
   */
  async auditLogs(query: AuditLogQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new ApiException('INVALID_DATE_RANGE', 'The start date must be before the end date.');
    }
    const rows = await this.admin.auditLogs({
      entityType: query.entityType,
      actorType: query.actorType,
      action: query.action,
      entityId: query.entityId,
      from,
      to,
      cursor,
      limit: query.limit,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toAuditLogResponse),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    const createdAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof value.id !== 'string' || !value.id) throw new Error('Invalid cursor');
    return { createdAt, id: value.id };
  } catch {
    throw new ApiException('INVALID_CURSOR', 'The audit log page cursor is invalid.');
  }
}
