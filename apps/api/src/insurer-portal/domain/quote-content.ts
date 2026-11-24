import type { QuoteAddOn, QuoteComponent, QuoteCondition } from '../../db/schema.js';
import { kwachaToNgwee } from '../../common/money.js';

/** The parts of a final quote beyond its premium, as the insurer sends them, in kwacha. */
export interface QuoteContentInput {
  components?: Array<{ code: string; label: string; amount: number }>;
  excess?: number | null;
  addOns?: Array<{ code: string; label?: string; price: number; included: boolean; terms?: string | null }>;
  conditions?: Array<{ code: string; text: string; purchaseCritical: boolean }>;
}

export interface QuoteContent {
  componentsMinor: QuoteComponent[];
  excessMinor: number | null;
  addOns: QuoteAddOn[];
  conditions: QuoteCondition[];
}

const duplicated = (codes: string[]) => codes.find((code, index) => codes.indexOf(code) !== index);

/**
 * Checks a quote's content against its premium and the add-on catalogue in
 * force. The premium breakdown, when given, must add up to the premium the
 * customer pays; an add-on must be one the platform knows; codes are unique.
 */
export function quoteContent(
  premiumMinor: number,
  input: QuoteContentInput,
  catalogue: ReadonlyArray<{ code: string; label: string }>,
): { value: QuoteContent } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const componentsMinor = (input.components ?? []).map((component) => ({
    code: component.code,
    label: component.label.trim(),
    amountMinor: kwachaToNgwee(component.amount),
  }));
  if (componentsMinor.length > 0) {
    const total = componentsMinor.reduce((sum, component) => sum + component.amountMinor, 0);
    if (total !== premiumMinor) {
      errors.components = 'The premium breakdown must add up to the premium.';
    }
    const repeated = duplicated(componentsMinor.map((component) => component.code));
    if (repeated) errors.components = `The breakdown lists ${repeated} twice.`;
  }

  const known = new Map(catalogue.map((entry) => [entry.code, entry.label]));
  const addOns: QuoteAddOn[] = [];
  for (const addOn of input.addOns ?? []) {
    const label = addOn.label?.trim() || known.get(addOn.code);
    if (!known.has(addOn.code) || !label) {
      errors.addOns = `${addOn.code} is not in the add-on catalogue.`;
      continue;
    }
    if (addOn.included && addOn.price !== 0) {
      errors.addOns = `${addOn.code} is included, so it cannot also have a price.`;
      continue;
    }
    addOns.push({
      code: addOn.code,
      label,
      priceMinor: kwachaToNgwee(addOn.price),
      included: addOn.included,
      terms: addOn.terms?.trim() || null,
    });
  }
  const repeatedAddOn = duplicated(addOns.map((addOn) => addOn.code));
  if (repeatedAddOn) errors.addOns = `${repeatedAddOn} is offered twice.`;

  const conditions = (input.conditions ?? []).map((condition) => ({
    code: condition.code,
    text: condition.text.trim(),
    purchaseCritical: condition.purchaseCritical,
  }));
  if (conditions.some((condition) => !condition.text)) errors.conditions = 'Every condition needs its wording.';
  const repeatedCondition = duplicated(conditions.map((condition) => condition.code));
  if (repeatedCondition) errors.conditions = `${repeatedCondition} is listed twice.`;

  if (Object.keys(errors).length > 0) return { errors };
  return {
    value: {
      componentsMinor,
      excessMinor: input.excess === undefined || input.excess === null ? null : kwachaToNgwee(input.excess),
      addOns,
      conditions,
    },
  };
}

/** The purchase-critical conditions a customer has not accepted; empty when they may pay. */
export function unacceptedCriticalConditions(conditions: readonly QuoteCondition[], accepted: readonly string[]): string[] {
  return conditions.filter((condition) => condition.purchaseCritical && !accepted.includes(condition.code)).map((condition) => condition.code);
}
