import { divideRoundHalfUp } from '../../common/money.js';
import type { CoverageDuration } from '../../common/domain/enums.js';

const QUARTERS: Record<CoverageDuration, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

/**
 * The PIA minimum premium for this requested term, in ngwee.
 *
 * The configured rate is annual, so a one-, two- or three-quarter policy is
 * charged for the corresponding share of the year. Rounding happens once, at
 * the smallest stored currency unit, using the platform's single money rule.
 */
export function premiumFloorMinor(
  declaredVehicleValueMinor: number,
  piaRateBps: number,
  coverageDuration: CoverageDuration,
): number {
  return Number(
    divideRoundHalfUp(
      BigInt(declaredVehicleValueMinor) * BigInt(piaRateBps) * BigInt(QUARTERS[coverageDuration]),
      10_000n * 4n,
    ),
  );
}

export function coverTermLabel(coverageDuration: CoverageDuration): string {
  return `${QUARTERS[coverageDuration] * 3}-month`;
}
