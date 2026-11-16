import { divideRoundHalfUp } from '../../common/money.js';
import type { CoverageDuration } from '../../common/domain/enums.js';
import { premiumFloorMinor } from '../../insurer-portal/domain/premium-floor.js';

const QUARTERS: Record<CoverageDuration, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

/**
 * Produces an indicative premium without applying a customer-specific discount.
 * Every calculation happens in ngwee and is rounded once at each business
 * boundary, so a displayed estimate cannot fall below the regulatory floor.
 */
export function estimateProductPremiumMinor(
  declaredVehicleValueMinor: number,
  productRateBps: number,
  usageLoadingBps: number,
  piaRateBps: number,
  coverageDuration: CoverageDuration,
) {
  const annualProductPremiumMinor = Number(divideRoundHalfUp(
    BigInt(declaredVehicleValueMinor) * BigInt(productRateBps) * BigInt(usageLoadingBps),
    10_000n * 10_000n,
  ));
  const indicativePremiumMinor = Number(divideRoundHalfUp(
    BigInt(annualProductPremiumMinor) * BigInt(QUARTERS[coverageDuration]),
    4n,
  ));
  const regulatoryFloorMinor = premiumFloorMinor(declaredVehicleValueMinor, piaRateBps, coverageDuration);
  return {
    indicativePremiumMinor,
    regulatoryFloorMinor,
    premiumMinor: Math.max(indicativePremiumMinor, regulatoryFloorMinor),
    floorApplied: indicativePremiumMinor < regulatoryFloorMinor,
  };
}
