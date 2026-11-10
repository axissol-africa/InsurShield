import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService, type DocumentRecord } from '../documents/documents.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee } from '../common/money.js';
import { newReference } from '../common/domain/reference.js';
import { ClaimsRepository } from './claims.repository.js';
import type { Transaction } from '../db/database.module.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { toClaimListItem, toClaimNotified, type ClaimListItem, type ClaimNotified } from './dto/claim.response.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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

  async notify(
    customer: CustomerPrincipal,
    dto: NotifyClaimDto,
    transaction?: Transaction,
  ): Promise<ClaimNotified> {
    const documentIds = dto.supportingDocumentIds ?? [];
    const submittedAt = new Date();

    const create = async (tx: Transaction) => {
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
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'claim.notified',
        entityType: 'CLAIM',
        entityId: created.claimNumber,
        after: {
          insurerId: created.insurerId,
          hasPolicy: Boolean(created.policyNumber),
          attachmentCount: documentIds.length,
          policeReport: created.policeReport,
        },
        note: 'Customer submitted the first claim notification.',
        correlationId: created.claimNumber,
      });
      await this.audit.transition(tx, {
        actor: auditActor(customer),
        entityType: 'CLAIM',
        entityId: created.claimNumber,
        fromStatus: null,
        toStatus: created.status,
        note: 'Claim notification submitted.',
        correlationId: created.claimNumber,
      });

      // Confirms to the customer that the platform has their claim, in the same
      // transaction that records it.
      await this.notifications.notify(tx, {
        customerId: customer.id,
        key: 'claim.received',
        entity: { type: 'CLAIM', id: created.claimNumber },
        values: { insurer: insurer.name, claimNumber: created.claimNumber },
      });
      return { claim: created, insurerName: insurer.name, supportingDocs: records };
    };
    const { claim, insurerName, supportingDocs } = transaction
      ? await create(transaction)
      : await this.repository.transaction(create);

    this.logger.log(`Claim ${claim.claimNumber} notified to ${insurerName}`);
    return toClaimNotified(claim, insurerName, supportingDocs);
  }
}
