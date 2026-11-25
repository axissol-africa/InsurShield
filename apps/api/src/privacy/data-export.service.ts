import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { toContract } from '../common/contract.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ngweeToKwacha } from '../common/money.js';
import { ClaimsService } from '../customer/claims.service.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import { NcdService } from '../customer/ncd.service.js';
import { PoliciesService } from '../customer/policies.service.js';
import { QuoteRequestsService } from '../customer/quote-requests.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { InspectionsService } from '../inspections/inspections.service.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';
import { PrivacyRepository } from './privacy.repository.js';

/**
 * Everything InsurShield holds about one customer, as one JSON document
 * (NFR-PRI-001, rule 5 of the batch 15 plan).
 *
 * Each part comes from the same service that serves it to the customer
 * elsewhere, so the export can hold nothing the customer could not already
 * see: no other person's records, no internal notes, no staff identities. It
 * is built on request and never stored; the audit trail records that it was
 * made and how much it held, not what.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly quoteRequests: QuoteRequestsService,
    private readonly policies: PoliciesService,
    private readonly claims: ClaimsService,
    private readonly ncd: NcdService,
    private readonly inspections: InspectionsService,
    private readonly serviceRequests: ServiceRequestsService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async export(customer: CustomerPrincipal) {
    const profile = await this.repository.profile(customer.id);
    if (!profile) throw ApiException.notFound('Customer', customer.id);

    const [consents, marketing, contactPreferences, vehicles, payments, notifications, uploaded] = await Promise.all([
      this.repository.consents(customer.id),
      this.repository.marketingConsents(customer.id),
      this.repository.contactPreferences(customer.id),
      this.repository.vehicles(customer.id),
      this.repository.payments(customer.id),
      this.repository.notifications(customer.id),
      this.repository.uploadedDocuments(customer.id),
    ]);
    const quoteRequests = await this.quoteRequests.list(customer.id);
    const policies = await this.policies.list(customer.id);
    const claims = await this.claims.list(customer.id);
    const ncdApplications = await this.ncd.list(customer.id);
    const inspections = await this.inspections.list(customer.id);
    const serviceRequests = [];
    for (const summary of await this.serviceRequests.listMine(customer)) {
      serviceRequests.push(await this.serviceRequests.getMine(customer, summary.reference));
    }
    const documents = [];
    for (const document of uploaded) {
      documents.push({ ...(await this.documents.record(document.id)), kind: document.kind, uploadedAt: document.uploadedAt.toISOString() });
    }

    const exportedAt = new Date();
    const counts = {
      quoteRequests: quoteRequests.length,
      policies: policies.length,
      payments: payments.length,
      serviceRequests: serviceRequests.length,
      claims: claims.length,
      ncdApplications: ncdApplications.length,
      inspections: inspections.length,
      notifications: notifications.length,
      documents: documents.length,
    };
    await this.repository.transaction((tx) =>
      this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'customer.data_exported',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: counts,
        note: 'The customer downloaded their data.',
        correlationId: customer.id,
      }),
    );

    return {
      exportedAt: exportedAt.toISOString(),
      about:
        'Everything InsurShield holds about you. Download links expire after a few minutes; download this again for fresh ones. ' +
        'Insurers keep their own records of the cover they issued.',
      profile: {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        emailVerifiedAt: profile.emailVerifiedAt?.toISOString() ?? null,
        createdAt: profile.createdAt.toISOString(),
      },
      consents: consents.map((consent) => ({ ...consent, acceptedAt: consent.acceptedAt.toISOString() })),
      marketingConsents: marketing.map((choice) => ({ granted: choice.granted, recordedAt: choice.recordedAt.toISOString() })),
      contactPreferences,
      vehicles,
      quoteRequests,
      payments: payments.map((payment) => ({
        transactionId: payment.transactionId,
        quoteRequestId: payment.quoteRequestId,
        status: toContract.paymentStatus(payment.status),
        method: payment.method,
        amount: ngweeToKwacha(payment.amountMinor),
        currency: payment.currency,
        paidFrom: payment.payerMsisdnMasked,
        createdAt: payment.createdAt.toISOString(),
        confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      })),
      policies,
      serviceRequests,
      claims,
      ncdApplications,
      inspections,
      notifications: notifications.map((notice) => ({ ...notice, createdAt: notice.createdAt.toISOString(), readAt: notice.readAt?.toISOString() ?? null })),
      documents,
    };
  }
}
