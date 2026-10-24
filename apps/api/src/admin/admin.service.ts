import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { sumToKwacha } from '../common/money.js';
import { AdminRepository } from './admin.repository.js';
import { toCustomerLookupResponse, toOverviewResponse, toRecentPolicyResponse } from './dto/admin-response.dto.js';

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
}
