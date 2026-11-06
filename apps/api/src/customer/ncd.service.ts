import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ApiException } from '../common/errors/api.exception.js';
import { newReference } from '../common/domain/reference.js';
import { ncdCodeRefusal, normaliseNcdCode } from './domain/ncd-code.js';
import type { ApplyForNcdDto, ValidateNcdCodeDto } from './dto/customer.dto.js';
import { toNcdApplicationResponse, type NcdApplicationResponse, type NcdCodeValidation } from './dto/ncd.response.js';
import { NcdRepository } from './ncd.repository.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';

@Injectable()
export class NcdService {
  private readonly logger = new Logger(NcdService.name);

  constructor(
    private readonly repository: NcdRepository,
    private readonly audit: AuditService,
  ) {}

  async list(customerId: string): Promise<NcdApplicationResponse[]> {
    const rows = await this.repository.listForCustomer(customerId);
    return rows.map(({ application, insurerName }) => toNcdApplicationResponse(application, insurerName));
  }

  /**
   * Applies for a no-claim discount. The insurer that held the claim-free
   * policy decides it, because only they hold the claims history the
   * application rests on.
   */
  async apply(customer: CustomerPrincipal, dto: ApplyForNcdDto): Promise<NcdApplicationResponse> {
    const submittedAt = new Date();
    const { application, insurerName } = await this.repository.transaction(async (tx) => {
      const insurer = await this.repository.findActiveInsurer(tx, dto.insurerId);
      if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);

      const created = await this.repository.insertApplication(tx, {
        applicationNumber: newReference('NCDA', submittedAt, randomInt),
        insurerId: insurer.id,
        customerId: customer.id,
        policyNumber: dto.policyNumber.trim(),
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        yearsClaimFree: dto.yearsClaimFree,
      });
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'ncd_application.submitted',
        entityType: 'NCD_APPLICATION',
        entityId: created.id,
        after: { applicationNumber: created.applicationNumber, insurerId: created.insurerId, yearsClaimFree: created.yearsClaimFree },
        note: 'Customer submitted a No Claim Discount application.',
        correlationId: created.applicationNumber,
      });
      await this.audit.transition(tx, {
        actor: auditActor(customer),
        entityType: 'NCD_APPLICATION',
        entityId: created.id,
        fromStatus: null,
        toStatus: created.status,
        note: 'NCD application submitted.',
        correlationId: created.applicationNumber,
      });
      return { application: created, insurerName: insurer.name };
    });

    this.logger.log(`NCD application ${application.applicationNumber} sent to ${insurerName}`);
    return toNcdApplicationResponse(application, insurerName);
  }

  /**
   * Checks a discount code the customer holds.
   *
   * This is public, so the response deliberately does not disclose any code,
   * insurer, percentage or refusal detail that could help enumerate discounts.
   */
  async validateCode(dto: ValidateNcdCodeDto): Promise<NcdCodeValidation> {
    const code = await this.repository.findCode(normaliseNcdCode(dto.code));
    const reason = ncdCodeRefusal(code, new Date());
    return { valid: !reason && Boolean(code) };
  }
}
