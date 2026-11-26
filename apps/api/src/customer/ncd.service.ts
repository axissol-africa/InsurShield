import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ApiException } from '../common/errors/api.exception.js';
import { newReference } from '../common/domain/reference.js';
import { ncdCodeRefusal, ncdVehicleMatches, normaliseNcdCode } from './domain/ncd-code.js';
import { NCD_DECLARATION_TEXT, NCD_DECLARATION_VERSION, ncdTierForYears } from './domain/ncd-policy.js';
import type { ApplyForNcdDto, SubmitNcdEvidenceDto, ValidateNcdCodeDto } from './dto/customer.dto.js';
import { toNcdApplicationResponse, type NcdApplicationResponse, type NcdCodeValidation } from './dto/ncd.response.js';
import { NcdRepository } from './ncd.repository.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { DocumentsService, type DocumentRecord } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import type { Transaction } from '../db/database.module.js';

@Injectable()
export class NcdService {
  constructor(
    private readonly repository: NcdRepository,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(customerId: string): Promise<NcdApplicationResponse[]> {
    return this.responses(await this.repository.listForCustomer(customerId));
  }

  async listForInsurer(insurerId: string): Promise<NcdApplicationResponse[]> {
    return this.responses(await this.repository.listForInsurer(insurerId));
  }

  async get(customerId: string, id: string): Promise<NcdApplicationResponse> {
    const row = await this.repository.detailsForCustomer(customerId, id);
    if (!row) throw ApiException.notFound('NCD application');
    const [view] = await this.responses([row]);
    return view;
  }

  async rules() {
    const { value, provisional } = await this.settings.effective('NCD_POLICY');
    return { ...value, provisional, declarationText: NCD_DECLARATION_TEXT };
  }

  async apply(customer: CustomerPrincipal, dto: ApplyForNcdDto, transaction?: Transaction): Promise<NcdApplicationResponse> {
    const create = async (tx: Transaction) => {
      await assertOpenCustomer(tx, customer.id);
      const source = await this.repository.lockSourcePolicy(tx, customer.id, dto.policyNumber.trim());
      if (!source) throw ApiException.notFound('Issued policy');
      if (dto.insurerId && dto.insurerId !== source.insurerId) {
        throw new ApiException('NCD_INSURER_MISMATCH', 'Choose the insurer shown on your policy.');
      }
      if (!source.chassisNumber?.trim()) {
        throw new ApiException('NCD_VEHICLE_UNVERIFIED', 'Your policy needs a verified chassis number. Ask your insurer to confirm the vehicle details.');
      }

      const submittedAt = new Date();
      const insurer = await this.repository.findInsurerTakingNewBusiness(tx, source.insurerId, submittedAt);
      if (!insurer) throw ApiException.conflict('INSURER_UNAVAILABLE', 'The insurer on this policy is currently unable to issue new discounts.');
      if (await this.repository.hasLiveApplication(tx, source.policyNumber, submittedAt)) {
        throw ApiException.conflict('NCD_APPLICATION_EXISTS', 'You already have an open application or an unused code for this policy.');
      }
      if (!dto.declaration) throw new ApiException('NCD_DECLARATION_REQUIRED', 'Accept the claim-free declaration before applying.');
      const { value } = await this.settings.effective('NCD_POLICY', submittedAt, tx);
      const tier = ncdTierForYears(value.tiers, dto.yearsClaimFree);
      if (!tier) {
        throw new ApiException('NCD_TIER_UNAVAILABLE', 'No discount tier covers the claim-free history entered.');
      }

      const application = await this.repository.insertApplication(tx, {
        applicationNumber: newReference('NCDA', submittedAt, randomInt),
        insurerId: insurer.id, customerId: customer.id, policyNumber: source.policyNumber,
        sourcePolicyNumber: source.policyNumber, sourceVehicleId: source.vehicleId,
        fullName: dto.fullName.trim(), phone: dto.phone.trim(), yearsClaimFree: dto.yearsClaimFree,
        declarationAcceptedAt: submittedAt, declarationVersion: NCD_DECLARATION_VERSION, submittedAt,
      });
      const actor = auditActor(customer);
      await this.audit.write(tx, {
        actor, action: 'ncd_application.submitted', entityType: 'NCD_APPLICATION', entityId: application.id,
        after: { applicationNumber: application.applicationNumber, insurerId: insurer.id, policyNumber: source.policyNumber,
          yearsClaimFree: application.yearsClaimFree, declarationVersion: NCD_DECLARATION_VERSION },
        note: 'Customer submitted a No Claim Discount application.', correlationId: application.applicationNumber,
      });
      await this.audit.transition(tx, {
        actor, entityType: 'NCD_APPLICATION', entityId: application.id, fromStatus: null, toStatus: application.status,
        note: 'NCD application submitted.', correlationId: application.applicationNumber,
      });
      await this.notifications.notify(tx, {
        customerId: customer.id, key: 'ncd.submitted',
        entity: { type: 'NCD_APPLICATION', id: application.applicationNumber }, values: { insurer: insurer.name },
      });
      return toNcdApplicationResponse(application, insurer.name, {
        discountPercentage: tier.percentage, expiresAt: null, evidence: [], codeStatus: null, vehicle: source.vehicle,
      });
    };
    return transaction ? create(transaction) : this.repository.transaction(create);
  }

  async submitEvidence(customer: CustomerPrincipal, id: string, dto: SubmitNcdEvidenceDto, transaction: Transaction) {
    await assertOpenCustomer(transaction, customer.id);
    const row = await this.repository.lockApplication(transaction, customer.id, id);
    if (!row) throw ApiException.notFound('NCD application');
    const { application, insurerName } = row;
    if (application.status !== 'VERIFICATION_REQUIRED' || application.verificationRevision !== dto.verificationRevision) {
      throw ApiException.conflict('NCD_VERIFICATION_CHANGED', 'This evidence request has changed. Open your application again to see the latest request.');
    }
    await this.documents.assertAttachable(transaction, customer, dto.documentIds, 'NCD_EVIDENCE', { requireClean: true });
    await this.repository.fileEvidence(transaction, application, dto.documentIds);
    const actor = auditActor(customer);
    await this.audit.write(transaction, {
      actor, action: 'ncd_application.evidence_submitted', entityType: 'NCD_APPLICATION', entityId: id,
      after: { verificationRevision: dto.verificationRevision, documentCount: dto.documentIds.length },
      note: 'Customer supplied the requested verification evidence.', correlationId: application.applicationNumber,
    });
    await this.audit.transition(transaction, {
      actor, entityType: 'NCD_APPLICATION', entityId: id, fromStatus: application.status, toStatus: 'UNDER_REVIEW',
      note: 'Verification evidence submitted.', correlationId: application.applicationNumber,
    });
    await this.notifications.notify(transaction, {
      customerId: customer.id, key: 'ncd.evidence_submitted',
      entity: { type: 'NCD_APPLICATION', id: application.applicationNumber }, values: { insurer: insurerName },
    });
    return { id };
  }

  async validateCode(customerId: string, dto: ValidateNcdCodeDto): Promise<NcdCodeValidation> {
    const code = await this.repository.findBoundCode(normaliseNcdCode(dto.code), customerId);
    if (!code?.expiresAt || ncdCodeRefusal(code, new Date()) || !dto.insurerIds.includes(code.insurerId)
      || !ncdVehicleMatches(code.sourceVehicle, dto.vehicleDetails)
      || (dto.renewalOfPolicyNumber && dto.renewalOfPolicyNumber !== code.sourcePolicyNumber)) return { valid: false };
    return { valid: true, percentage: code.percentage, insurerId: code.insurerId, expiresAt: code.expiresAt.toISOString() };
  }

  private async responses(rows: Awaited<ReturnType<NcdRepository['listForCustomer']>>, tx?: Transaction) {
    if (!rows.length) return [];
    const now = new Date();
    const { value } = await this.settings.effective('NCD_POLICY', now, tx);
    const evidence = await this.repository.evidenceOf(rows.map(({ application }) => application.id), tx);
    const byApplication = new Map<string, DocumentRecord[]>();
    for (const { id, documentId } of evidence) {
      const current = byApplication.get(id) ?? [];
      current.push(await this.documents.record(documentId, tx));
      byApplication.set(id, current);
    }
    return rows.map(({ application, insurerName, codePercentage, expiresAt, redeemedAt, revokedAt, vehicle }) => {
      const approvable = application.sourcePolicyNumber && application.status !== 'REJECTED';
      const discountPercentage = codePercentage ?? (approvable ? ncdTierForYears(value.tiers, application.yearsClaimFree)?.percentage ?? null : null);
      const codeStatus = !application.approvedCodeId ? null
        : redeemedAt ? 'Used' : !application.sourcePolicyNumber || !expiresAt || revokedAt ? 'Unavailable'
          : expiresAt <= now ? 'Expired' : 'Available';
      return toNcdApplicationResponse(application, insurerName, {
        discountPercentage, expiresAt: expiresAt?.toISOString() ?? null, vehicle,
        evidence: byApplication.get(application.id) ?? [], codeStatus,
      });
    });
  }
}
