import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService, type DocumentRecord } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee } from '../common/money.js';
import { newReference } from '../common/domain/reference.js';
import { ClaimsRepository } from './claims.repository.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { toClaimListItem, toClaimNotified, type ClaimListItem, type ClaimNotified } from './dto/claim.response.js';
import type { NotifyClaimDto } from './dto/customer.dto.js';

/**
 * First notification of a claim.
 *
 * InsurShield's role ends here (FR-CLM-006): we record the notification,
 * issue the claim number the customer quotes on the phone, and make it
 * visible to the insurer. Assessment and settlement happen in the insurer's
 * own system, which is why there is no status beyond "received".
 */
@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly repository: ClaimsRepository,
    private readonly documents: DocumentsService,
  ) {}

  async list(customerId: string): Promise<ClaimListItem[]> {
    const rows = await this.repository.listForCustomer(customerId);
    const attachments = await this.repository.attachmentsOf(rows.map((row) => row.claim.claimNumber));

    const items: ClaimListItem[] = [];
    for (const { claim, insurerName, customerEmail } of rows) {
      const supportingDocs: DocumentRecord[] = [];
      for (const attachment of attachments.filter((candidate) => candidate.claimNumber === claim.claimNumber)) {
        supportingDocs.push(await this.documents.record(attachment.documentId));
      }
      items.push(toClaimListItem(claim, insurerName, customerEmail, supportingDocs));
    }
    return items;
  }

  async notify(customer: CustomerPrincipal, dto: NotifyClaimDto): Promise<ClaimNotified> {
    const documentIds = dto.supportingDocumentIds ?? [];
    const submittedAt = new Date();

    const { claim, insurerName, supportingDocs } = await this.repository.transaction(async (tx) => {
      const insurer = await this.repository.findInsurer(tx, dto.insurerId);
      if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);

      await this.documents.assertAttachable(tx, customer, documentIds, 'CLAIM_ATTACHMENT');

      // A claim may name a policy the customer holds; one that is not theirs is
      // dropped rather than refused, so a typo cannot block a genuine claim.
      const policyNumber = dto.policyNumber
        ? ((await this.repository.findOwnedPolicyNumber(tx, customer.id, dto.policyNumber)) ?? null)
        : null;

      const created = await this.repository.insertClaim(tx, {
        claimNumber: newReference('CLM', submittedAt, randomInt),
        status: 'NOTIFIED',
        insurerId: insurer.id,
        customerId: customer.id,
        policyNumber,
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        email: dto.email?.trim() ?? null,
        plate: dto.plate.trim(),
        vehicleLabel: dto.vehicle.trim(),
        type: dto.type,
        incidentDate: new Date(dto.incidentDate),
        location: dto.location.trim(),
        description: dto.description.trim(),
        estimatedLossMinor: dto.estimatedLoss === undefined || dto.estimatedLoss === null ? null : kwachaToNgwee(dto.estimatedLoss),
        policeReport: dto.policeReport ?? false,
        policeReportNumber: dto.policeReportNumber?.trim() ?? null,
        lateReason: dto.lateReason?.trim() ?? null,
      });
      await this.repository.insertAttachments(tx, created.claimNumber, documentIds);

      // The documents are locked and known to exist, so these reads cannot fail after the commit.
      const records: DocumentRecord[] = [];
      for (const documentId of documentIds) {
        records.push(await this.documents.record(documentId, tx));
      }
      return { claim: created, insurerName: insurer.name, supportingDocs: records };
    });

    this.logger.log(`Claim ${claim.claimNumber} notified to ${insurerName}`);
    return toClaimNotified(claim, insurerName, supportingDocs);
  }
}
