import { Controller, Get, Query } from '@nestjs/common';
import { IsString, isUUID, MaxLength } from 'class-validator';
import { Public } from '../common/auth/auth.guard.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ReputationService } from './reputation.service.js';

const MAX_INSURERS = 100;

class InsurerReputationQuery {
  @IsString() @MaxLength(MAX_INSURERS * 37 - 1) insurerIds!: string;
}

@Controller('insurer-reputation')
export class ReputationController {
  constructor(private readonly reputation: ReputationService) {}

  @Public()
  @ApiRateLimit(API_LIMITS.publicRead)
  @Get()
  list(@Query() query: InsurerReputationQuery) {
    const requested = query.insurerIds.split(',');
    if (requested.length > MAX_INSURERS || requested.some((id) => !isUUID(id))) {
      throw new ApiException('INVALID_INSURER_IDS', 'Select up to 100 valid insurers.');
    }
    return this.reputation.publicList([...new Set(requested.map((id) => id.toLowerCase()))]);
  }
}
