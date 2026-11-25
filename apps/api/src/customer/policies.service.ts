import { Injectable } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { openRenewal, renewalState } from './domain/renewal.js';
import { toPolicyResponse, type PolicyResponse } from './dto/policy.response.js';
import { PoliciesRepository, type PolicyWithParties } from './policies.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import type { RenewalProduct } from './dto/policy.response.js';
import type { CustomerPrincipal } from './customer-principal.js';

@Injectable()
export class PoliciesService {
  constructor(
    private readonly repository: PoliciesRepository,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
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
   * A renewal is a new product selection, not a repeat broadcast to every
   * insurer. The web already carries the customer's vehicle and risk answers
   * into the selection journey; this endpoint protects old clients from
   * reintroducing the retired broadcast workflow.
   */
  async renew(customer: CustomerPrincipal, policyNumber: string): Promise<never> {
    return this.repository.transaction(async (tx) => {
      const policy = await this.repository.lockOwned(tx, customer.id, policyNumber);
      if (!policy) throw ApiException.notFound('Policy', policyNumber);

      const now = new Date();
      const open = openRenewal(await this.repository.renewalsOf([policy.policyNumber], tx), now);
      if (open) {
        throw ApiException.conflict('RENEWAL_IN_PROGRESS', `A renewal for this policy is already open as ${open.id}.`);
      }

      throw ApiException.conflict(
        'RENEWAL_REQUIRES_PRODUCT_SELECTION',
        'Review current insurance products before renewing. Your vehicle and policy details stay available in the renewal journey.',
      );
    });
  }

  private async responses(rows: PolicyWithParties[]): Promise<PolicyResponse[]> {
    const renewals = await this.repository.renewalsOf(rows.map((row) => row.policy.policyNumber));
    const now = new Date();
    const { value: renewal } = await this.settings.effective('RENEWAL_POLICY', now);
    const bought = [...new Set(rows.flatMap((row) => (row.policy.productVersionId ? [row.policy.productVersionId] : [])))];
    const current = await this.repository.currentVersionsFor(bought, now);

    const responses: PolicyResponse[] = [];
    for (const row of rows) {
      const { policy } = row;
      responses.push(
        toPolicyResponse(
          row,
          renewalState(
            policy.policyEndDate,
            renewals.filter((entry) => entry.renewalOfPolicyNumber === policy.policyNumber),
            now,
            renewal.windowDays,
          ),
          policy.quoteDocumentId ? await this.documents.record(policy.quoteDocumentId) : null,
          policy.certificateDocumentId ? await this.documents.record(policy.certificateDocumentId) : null,
          renewalProductOf(policy.productVersionId, current),
        ),
      );
    }
    return responses;
  }
}

/**
 * The product a renewal starts from (quote-flow step 12): the newest version
 * of the product bought that a customer may buy today. A policy from before
 * product selection has none to carry over.
 */
function renewalProductOf(
  productVersionId: string | null,
  current: ReadonlyMap<string, { id: string; name: string; versionNumber: number }>,
): RenewalProduct | null {
  if (!productVersionId) return null;
  const version = current.get(productVersionId);
  if (!version) return { available: false, reason: 'This product is no longer offered. Compare current products to renew.' };
  return { available: true, productVersionId: version.id, name: version.name, versionNumber: version.versionNumber, termsChanged: version.id !== productVersionId };
}
