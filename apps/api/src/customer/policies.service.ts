import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { newReference } from '../common/domain/reference.js';
import { addDays, REQUEST_VALIDITY_DAYS } from './domain/cover-period.js';
import { openRenewal, renewalState } from './domain/renewal.js';
import { toPolicyResponse, type PolicyResponse } from './dto/policy.response.js';
import type { QuoteRequestResponse } from './dto/quote-request.response.js';
import { PoliciesRepository, type PolicyWithParties } from './policies.repository.js';
import { QuoteRequestsService } from './quote-requests.service.js';

@Injectable()
export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name);

  constructor(
    private readonly repository: PoliciesRepository,
    private readonly quoteRequests: QuoteRequestsService,
    private readonly documents: DocumentsService,
  ) {}

  async list(customerId: string): Promise<PolicyResponse[]> {
    return this.responses(await this.repository.listForCustomer(customerId));
  }

  async get(customerId: string, policyNumber: string): Promise<PolicyResponse> {
    const row = await this.repository.findOwned(customerId, policyNumber);
    if (!row) throw ApiException.notFound('Policy', policyNumber);
    const [response] = await this.responses([row]);
    return response;
  }

  /**
   * Starts a renewal: a fresh quote request carrying this policy's vehicle and
   * cover forward, sent to every active insurer. Renewal is deliberately a new
   * request rather than an extension: the point is to compare the market
   * again, and the customer may well leave the incumbent.
   */
  async renew(customerId: string, policyNumber: string): Promise<QuoteRequestResponse> {
    const response = await this.repository.transaction(async (tx) => {
      const policy = await this.repository.lockOwned(tx, customerId, policyNumber);
      if (!policy) throw ApiException.notFound('Policy', policyNumber);

      const now = new Date();
      const open = openRenewal(await this.repository.renewalsOf([policy.policyNumber], tx), now);
      if (open) {
        throw ApiException.conflict('RENEWAL_IN_PROGRESS', `A renewal for this policy is already open as ${open.id}.`);
      }

      const insurerIds = await this.quoteRequests.activeInsurerIds(tx);

      // The original request holds the declared value and usage. A policy whose
      // request has since been pruned still renews: the value falls back to the
      // premium basis on the policy, and the customer confirms it in the journey.
      const original = policy.quoteRequestId
        ? await this.repository.findCarriedForward(tx, policy.quoteRequestId)
        : undefined;
      return this.quoteRequests.distribute(
        tx,
        {
          id: newReference('QR', now, randomInt),
          status: 'SUBMITTED',
          submittedAt: now,
          expiresAt: addDays(now, REQUEST_VALIDITY_DAYS),
          customerId,
          vehicleId: policy.vehicleId,
          vehicleValueMinor: original?.vehicleValueMinor ?? policy.premiumMinor,
          vehicleUsage: original?.vehicleUsage ?? 'Individual',
          insuranceType: original?.insuranceType ?? 'COMPREHENSIVE',
          coverageDuration: original?.coverageDuration ?? 'Q4',
          matchRtsaAnniversary: original?.matchRtsaAnniversary ?? false,
          rtsaRegistrationDate: original?.rtsaRegistrationDate ?? null,
          // New cover picks up where the expiring policy leaves off.
          policyStartDate: policy.policyEndDate,
          renewalOfPolicyNumber: policy.policyNumber,
        },
        insurerIds,
      );
    });

    this.logger.log(`Renewal ${policyNumber} -> ${response.id} for ${response.insurerIds.length} insurers`);
    return response;
  }

  private async responses(rows: PolicyWithParties[]): Promise<PolicyResponse[]> {
    const renewals = await this.repository.renewalsOf(rows.map((row) => row.policy.policyNumber));
    const now = new Date();

    const responses: PolicyResponse[] = [];
    for (const row of rows) {
      const { policy } = row;
      responses.push(
        toPolicyResponse(
          row,
          renewalState(
            policy.policyEndDate,
            renewals.filter((renewal) => renewal.renewalOfPolicyNumber === policy.policyNumber),
            now,
          ),
          policy.quoteDocumentId ? await this.documents.record(policy.quoteDocumentId) : null,
          policy.certificateDocumentId ? await this.documents.record(policy.certificateDocumentId) : null,
        ),
      );
    }
    return responses;
  }
}
