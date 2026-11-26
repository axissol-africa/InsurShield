export const NCD_DECLARATION_VERSION = '1';
export const NCD_DECLARATION_TEXT = 'I confirm that the claim-free history I provided is accurate and authorise the insurer that held this policy to verify it.';

export function ncdTierForYears(tiers: readonly { yearsClaimFree: number; percentage: number }[], years: number) {
  return [...tiers].sort((a, b) => b.yearsClaimFree - a.yearsClaimFree).find((tier) => tier.yearsClaimFree <= years);
}
