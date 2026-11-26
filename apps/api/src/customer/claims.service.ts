import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService, type DocumentRecord } from '../documents/documents.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee } from '../common/money.js';
import { newReference } from '../common/domain/reference.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import { SettingsService } from '../settings/settings.service.js';
import { SupportService } from '../support/support.service.js';
import { claimCoverType, claimResponseDay, claimTypeMatches, coveredOnIncidentDay, reportingDaysSince } from './domain/claim-intake.js';
import { ClaimsRepository } from './claims.repository.js';
import type { Transaction } from '../db/database.module.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { toClaimListItem, toClaimNotified, type ClaimListItem, type ClaimNotified } from './dto/claim.response.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { NotifyClaimDto } from './dto/customer.dto.js';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly repository: ClaimsRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly support: SupportService,
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

  async intakeRules() {
    const { value, provisional } = await this.settings.effective('CLAIM_REPORTING');
    return { ...value, provisional };
  }

  async notify(
    customer: CustomerPrincipal,
    dto: NotifyClaimDto,
    transaction?: Transaction,
  ): Promise<ClaimNotified> {
    const documentIds = dto.supportingDocumentIds ?? [];
    const submittedAt = new Date();

    const create = async (tx: Transaction) => {
      await assertOpenCustomer(tx, customer.id);
      const reference = dto.policyNumber?.trim();
      if (!reference) throw new ApiException('CLAIM_POLICY_REQUIRED', 'Choose the policy that covered the vehicle on the day of the incident.');
      const covered = await this.repository.lockOwnedPolicy(tx, customer.id, reference);
      if (!covered) throw ApiException.notFound('Policy');
      const policy = covered.policy;
      const insurer = await this.repository.lockInsurer(tx, policy.insurerId);
      if (!insurer || insurer.status === 'DELETED' || insurer.deletedAt !== null) {
        throw ApiException.conflict('CLAIM_INSURER_UNAVAILABLE', 'This insurer no longer services claims on InsurShield. Contact support with your policy reference.', {
          reference: policy.policyNumber, contact: this.support.helpDesk(),
        });
      }
      if (dto.insurerId && dto.insurerId !== insurer.id) {
        throw new ApiException('CLAIM_INSURER_MISMATCH', 'Choose the insurer shown on your policy.');
      }

      const incident = new Date(dto.incidentDate);
      const incidentDay = lusakaDay(incident);
      const daysSinceIncident = reportingDaysSince(incidentDay, submittedAt);
      if (daysSinceIncident < 0) throw new ApiException('CLAIM_FUTURE_INCIDENT', 'Enter an incident date on or before today.');
      if (!coveredOnIncidentDay({ ...policy, cancellationDay: covered.cancellationDay }, incidentDay)) {
        throw new ApiException('CLAIM_OUTSIDE_COVER', 'The selected policy did not cover this vehicle on the incident date. Review the date or contact support.');
      }
      const coverType = claimCoverType(policy.coverage);
      if (!coverType) {
        throw new ApiException('CLAIM_COVER_UNVERIFIED', 'We could not verify the cover on this policy. Contact support with your policy reference.', HttpStatus.BAD_REQUEST, {
          reference: policy.policyNumber, contact: this.support.helpDesk(),
        });
      }

      const { value: rules, version } = await this.settings.effective('CLAIM_REPORTING', submittedAt, tx);
      if (claimTypeMatches(rules.excludedTypes[coverType], dto.type)) {
        throw new ApiException('CLAIM_TYPE_NOT_COVERED', 'This incident type does not match the cover on your policy. Contact your insurer if you need help.');
      }
      const lateReason = dto.lateReason?.trim();
      const lateSubmission = daysSinceIncident > rules.reportingDays;
      if (lateSubmission && !lateReason) {
        throw new ApiException('CLAIM_LATE_REASON_REQUIRED', 'Explain why you are reporting after the allowed window so your insurer can review it.', HttpStatus.BAD_REQUEST, {
          reportingDays: rules.reportingDays,
        });
      }
      if (claimTypeMatches(rules.requirePoliceReportFor, dto.type) && (!dto.policeReport || !dto.policeReportNumber?.trim())) {
        throw new ApiException('CLAIM_POLICE_REPORT_REQUIRED', 'Provide the police report reference for this incident type.');
      }
      if (claimTypeMatches(rules.requireAttachmentsFor, dto.type) && documentIds.length === 0) {
        throw new ApiException('CLAIM_EVIDENCE_REQUIRED', 'Attach supporting evidence for this incident type.');
      }
      await this.documents.assertAttachable(tx, customer, documentIds, 'CLAIM_ATTACHMENT', { requireClean: true });

      const created = await this.repository.insertClaim(tx, {
        claimNumber: newReference('CLM', submittedAt, randomInt),
        status: 'NOTIFIED',
        insurerId: insurer.id,
        customerId: customer.id,
        policyNumber: policy.policyNumber,
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        email: dto.email?.trim() ?? null,
        plate: covered.plate,
        vehicleLabel: [covered.year, covered.make, covered.model].filter(Boolean).join(' '),
        type: dto.type,
        incidentDate: new Date(`${incidentDay}T00:00:00.000Z`),
        location: dto.location.trim(),
        description: dto.description.trim(),
        estimatedLossMinor: dto.estimatedLoss === undefined || dto.estimatedLoss === null ? null : kwachaToNgwee(dto.estimatedLoss),
        policeReport: dto.policeReport ?? false,
        policeReportNumber: dto.policeReportNumber?.trim() ?? null,
        lateReason: lateReason || null,
        lateSubmission,
        responseDueOn: claimResponseDay(submittedAt, rules.responseDays),
        intakeRuleVersion: version,
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
          policyNumber: policy.policyNumber,
          lateSubmission,
          intakeRuleVersion: version,
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
