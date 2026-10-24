import { IsNumber, Max, Min } from 'class-validator';
import { MAX_RATE_BPS, MIN_RATE_BPS } from '../../common/domain/money-limits.js';
import { bpsToPercent } from '../../common/money.js';
import type { PiaRow } from '../pia.repository.js';

const MIN_PERCENT = MIN_RATE_BPS / 100;
const MAX_PERCENT = MAX_RATE_BPS / 100;

export class SetPiaConfigDto {
  /** Regulatory floor: no insurer may quote below this share of vehicle value. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_PERCENT, { message: 'The PIA rate cannot be negative.' })
  @Max(MAX_PERCENT, { message: `The PIA rate cannot exceed ${MAX_PERCENT}%.` })
  piaRatePercentage!: number;
}

// Seeded at install; the regulatory default stands in when the row is missing.
const DEFAULT_PIA_RATE_PERCENT = 4;

export function toPiaResponse(config: PiaRow | undefined) {
  if (!config) return { piaRatePercentage: DEFAULT_PIA_RATE_PERCENT, lastUpdated: null, updatedBy: null };
  return {
    piaRatePercentage: bpsToPercent(config.piaRateBps),
    lastUpdated: config.updatedAt.toISOString(),
    updatedBy: config.updatedBy,
  };
}
