import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ApiException } from '../common/errors/api.exception.js';
import { newReference } from '../common/domain/reference.js';
import { ncdCodeRefusal, normaliseNcdCode } from './domain/ncd-code.js';
import type { ApplyForNcdDto, ValidateNcdCodeDto } from './dto/customer.dto.js';
import { toNcdApplicationResponse, toUsableNcdCode, type NcdApplicationResponse, type NcdCodeValidation } from './dto/ncd.response.js';
import { NcdRepository } from './ncd.repository.js';

@Injectable()
export class NcdService {
  private readonly logger = new Logger(NcdService.name);

  constructor(private readonly repository: NcdRepository) {}

  async list(customerId: string): Promise<NcdApplicationResponse[]> {
    const rows = await this.repository.listForCustomer(customerId);
    return rows.map(({ application, insurerName }) => toNcdApplicationResponse(application, insurerName));
  }

  /**
   * Applies for a no-claim discount. The insurer that held the claim-free
   * policy decides it, because only they hold the claims history the
   * application rests on.
   */
  async apply(customerId: string, dto: ApplyForNcdDto): Promise<NcdApplicationResponse> {
    const submittedAt = new Date();
    const { application, insurerName } = await this.repository.transaction(async (tx) => {
      const insurer = await this.repository.findActiveInsurer(tx, dto.insurerId);
      if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);

      const created = await this.repository.insertApplication(tx, {
        applicationNumber: newReference('NCDA', submittedAt, randomInt),
        insurerId: insurer.id,
        customerId,
        policyNumber: dto.policyNumber.trim(),
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        yearsClaimFree: dto.yearsClaimFree,
      });
      return { application: created, insurerName: insurer.name };
    });

    this.logger.log(`NCD application ${application.applicationNumber} sent to ${insurerName}`);
    return toNcdApplicationResponse(application, insurerName);
  }

  /**
   * Checks a discount code the customer holds.
   *
   * The reply names the insurer, because a code only discounts that insurer's
   * quote: a customer applying it to anyone else's is the common mistake this
   * endpoint exists to catch before payment.
   */
  async validateCode(dto: ValidateNcdCodeDto): Promise<NcdCodeValidation> {
    const code = await this.repository.findCode(normaliseNcdCode(dto.code));
    const reason = ncdCodeRefusal(code, new Date());
    if (reason || !code) return { valid: false, reason: reason ?? 'NOT_FOUND' };
    return toUsableNcdCode(code);
  }
}
