import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { toContract } from '../common/contract.js';
import { ApiException } from '../common/errors/api.exception.js';
import {
  ClaimStatus,
  InsurerStatus,
  NcdStatus,
  PaymentStatus,
  PolicyStatus,
  QuoteRequestStatus,
} from '../generated/prisma/enums.js';

const daysAhead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

/**
 * Platform-wide figures for the administrator console.
 *
 * Every number here is counted from the database. Nothing is estimated or
 * padded: an empty platform reports zeros, because a console that invents
 * plausible figures is worse than one that admits it has no data yet.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [
      totalPolicies,
      activePolicies,
      awaitingCertificate,
      expiringSoon,
      totalInsurers,
      activeInsurers,
      openClaims,
      totalClaims,
      openQuoteRequests,
      quotedRequests,
      openNcd,
      totalCustomers,
      premiumAllTime,
      premiumThisMonth,
    ] = await this.prisma.$transaction([
      this.prisma.policy.count(),
      this.prisma.policy.count({ where: { status: PolicyStatus.ACTIVE } }),
      this.prisma.policy.count({ where: { status: PolicyStatus.AWAITING_INSURER_CERTIFICATE } }),
      this.prisma.policy.count({
        where: {
          status: PolicyStatus.ACTIVE,
          policyEndDate: { gte: new Date(), lte: daysAhead(30) },
        },
      }),
      this.prisma.insurer.count({ where: { status: { not: InsurerStatus.DELETED } } }),
      this.prisma.insurer.count({ where: { status: InsurerStatus.ACTIVE } }),
      this.prisma.claimNotification.count({ where: { status: ClaimStatus.NOTIFIED } }),
      this.prisma.claimNotification.count(),
      this.prisma.quoteRequest.count({ where: { status: QuoteRequestStatus.SUBMITTED } }),
      this.prisma.quoteRequest.count({ where: { status: QuoteRequestStatus.QUOTED } }),
      this.prisma.ncdApplication.count({
        where: { status: { in: [NcdStatus.SUBMITTED, NcdStatus.UNDER_REVIEW] } },
      }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      // Premium is taken from confirmed payments, not from policy records, so
      // an unpaid or failed transaction can never appear as revenue.
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.CONFIRMED },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.CONFIRMED, confirmedAt: { gte: startOfMonth() } },
        _sum: { amount: true },
      }),
    ]);

    return {
      policies: { total: totalPolicies, active: activePolicies, awaitingCertificate, expiringIn30Days: expiringSoon },
      insurers: { total: totalInsurers, active: activeInsurers, inactive: totalInsurers - activeInsurers },
      claims: { open: openClaims, total: totalClaims },
      quoteRequests: { awaitingQuotes: openQuoteRequests, quoted: quotedRequests },
      ncd: { open: openNcd },
      customers: { total: totalCustomers },
      premium: {
        currency: 'ZMW',
        allTime: premiumAllTime._sum.amount?.toNumber() ?? 0,
        thisMonth: premiumThisMonth._sum.amount?.toNumber() ?? 0,
      },
    };
  }

  /** Premium confirmed per month for the last `months`, oldest first. */
  async premiumByMonth(months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1), 1);
    since.setHours(0, 0, 0, 0);

    const payments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.CONFIRMED, confirmedAt: { gte: since } },
      select: { amount: true, confirmedAt: true },
    });

    // Every month in the window is present, including the empty ones, so a
    // chart cannot imply activity in a month that had none.
    const buckets = new Map<string, number>();
    for (let index = 0; index < months; index += 1) {
      const date = new Date(since.getFullYear(), since.getMonth() + index, 1);
      buckets.set(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, 0);
    }

    for (const payment of payments) {
      if (!payment.confirmedAt) continue;
      const key = `${payment.confirmedAt.getFullYear()}-${String(payment.confirmedAt.getMonth() + 1).padStart(2, '0')}`;
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + payment.amount.toNumber());
    }

    return [...buckets.entries()].map(([month, total]) => ({ month, total }));
  }

  /** Most recent policies across every insurer. */
  async recentPolicies(limit = 8) {
    const policies = await this.prisma.policy.findMany({
      take: limit,
      orderBy: { receivedAt: 'desc' },
      include: {
        insurer: { select: { name: true } },
        customer: { select: { fullName: true } },
        vehicle: { select: { make: true, model: true, year: true, plateNumber: true } },
      },
    });

    return policies.map((policy) => ({
      policyNumber: policy.policyNumber,
      status: toContract.policyStatus(policy.status),
      insurer: policy.insurer.name,
      customerName: policy.customer.fullName,
      vehicle: `${policy.vehicle.year} ${policy.vehicle.make} ${policy.vehicle.model}`.trim(),
      plateNumber: policy.vehicle.plateNumber,
      premium: policy.premium.toNumber(),
      receivedAt: policy.receivedAt.toISOString(),
      issuedAt: policy.issuedAt?.toISOString() ?? null,
    }));
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

    const customer = await this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: needle }, { phone: query.trim() }],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        createdAt: true,
        consents: {
          orderBy: { acceptedAt: 'desc' },
          take: 1,
          select: { privacyVersion: true, acceptedAt: true },
        },
        _count: { select: { quoteRequests: true, policies: true, claims: true } },
      },
    });

    if (!customer) throw ApiException.notFound('Customer account');

    const { consents, _count, ...profile } = customer;
    return {
      ...profile,
      phone: profile.phone.startsWith('pending:') ? null : profile.phone,
      createdAt: profile.createdAt.toISOString(),
      consent: consents[0]
        ? { noticeVersion: consents[0].privacyVersion, acceptedAt: consents[0].acceptedAt.toISOString() }
        : null,
      counts: {
        quoteRequests: _count.quoteRequests,
        policies: _count.policies,
        claims: _count.claims,
      },
    };
  }
}
