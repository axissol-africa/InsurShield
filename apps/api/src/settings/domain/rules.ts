import { z } from 'zod';
import {
  DOCUMENT_RETENTION_CLASSES,
  RULE_SETTING_KEYS,
  type DocumentRetentionClass,
  type RuleSettingKey,
} from '../../common/domain/enums.js';

const QUESTION_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const question = z.object({
  code: z.string().regex(QUESTION_CODE),
  label: z.string().trim().min(2).max(240),
  helpText: z.string().trim().max(1_000).optional(),
  required: z.boolean().default(false),
});

const addOn = z.object({
  code: z.string().regex(QUESTION_CODE),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
});

const ncdPolicy = z.object({
  validityDays: z.number().int().min(1).max(3_660),
  tiers: z.array(z.object({
    yearsClaimFree: z.number().int().min(1).max(99),
    percentage: z.number().int().min(0).max(100),
  })).min(1).max(20),
}).superRefine((value, context) => {
  const years = value.tiers.map((tier) => tier.yearsClaimFree);
  if (new Set(years).size !== years.length) {
    context.addIssue({ code: 'custom', path: ['tiers'], message: 'Each NCD tier must use a different claim-free year.' });
  }
});

const documentRetention = z.object({
  daysByClass: z.record(z.enum(DOCUMENT_RETENTION_CLASSES), z.number().int().min(1).max(36_500)),
}).superRefine((value, context) => {
  for (const kind of DOCUMENT_RETENTION_CLASSES) {
    if (value.daysByClass[kind] === undefined) {
      context.addIssue({ code: 'custom', path: ['daysByClass', kind], message: `Set the retention period for ${kind}.` });
    }
  }
});

const declineReason = z.object({
  code: z.string().regex(QUESTION_CODE),
  /** What the customer reads. */
  customerText: z.string().trim().min(2).max(240),
  /** What insurer staff and InsurShield operations read; never sent to a customer. */
  internalText: z.string().trim().min(2).max(500),
});

const declineReasons = z.object({ reasons: z.array(declineReason).min(1).max(40) }).superRefine((value, context) => {
  const codes = value.reasons.map((reason) => reason.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: 'Each decline reason must use a different code.' });
  }
});

/**
 * An approved levy, tax or fee added to the premium. A fixed amount or a share
 * of the premium, optionally only for some cover types, and optionally only
 * when the policy is aligned to the vehicle's RTSA anniversary.
 */
const paymentCharge = z.object({
  code: z.string().regex(QUESTION_CODE),
  label: z.string().trim().min(2).max(120),
  basis: z.enum(['FIXED', 'PERCENT_OF_PREMIUM']),
  amountMinor: z.number().int().min(0).max(100_000_000).optional(),
  basisPoints: z.number().int().min(0).max(10_000).optional(),
  coverTypes: z.array(z.string().regex(QUESTION_CODE)).max(20).optional(),
  when: z.enum(['ALWAYS', 'RTSA_ANNIVERSARY']).default('ALWAYS'),
}).superRefine((value, context) => {
  if (value.basis === 'FIXED' && value.amountMinor === undefined) {
    context.addIssue({ code: 'custom', path: ['amountMinor'], message: 'Set the fixed amount in ngwee.' });
  }
  if (value.basis === 'PERCENT_OF_PREMIUM' && value.basisPoints === undefined) {
    context.addIssue({ code: 'custom', path: ['basisPoints'], message: 'Set the share of the premium in basis points.' });
  }
});

const paymentCharges = z.object({ charges: z.array(paymentCharge).max(20) }).superRefine((value, context) => {
  const codes = value.charges.map((charge) => charge.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: 'custom', path: ['charges'], message: 'Each charge must use a different code.' });
  }
});

const schemas = {
  PIA_FLOOR: z.object({ rateBps: z.number().int().min(0).max(10_000) }),
  QUOTE_REPLY_DEADLINE: z.object({ days: z.number().int().min(1).max(90) }),
  NCD_POLICY: ncdPolicy,
  DRIVER_QUESTIONS: z.object({ questions: z.array(question).max(40) }),
  RISK_QUESTIONS: z.object({ questions: z.array(question).max(40) }),
  ADD_ON_CATALOGUE: z.object({ addOns: z.array(addOn).max(100) }),
  USAGE_LOADINGS: z.object({
    /** A multiplier in basis points: 10,000 means no loading. */
    loadings: z.record(z.string().regex(QUESTION_CODE), z.number().int().min(1).max(100_000)),
  }),
  DOCUMENT_RETENTION: documentRetention,
  QUOTE_DECLINE_REASONS: declineReasons,
  QUOTE_SLA_WARNING: z.object({ hoursBeforeDue: z.number().int().min(1).max(240) }),
  PAYMENT_CHARGES: paymentCharges,
  PAYMENT_PENDING_TIMEOUT: z.object({ minutes: z.number().int().min(2).max(24 * 60) }),
  ISSUANCE_DEADLINE: z.object({ hours: z.number().int().min(1).max(30 * 24) }),
  COMMISSION_RULE: z.object({ basisPoints: z.number().int().min(0).max(10_000) }),
  SETTLEMENT_PERIOD: z.object({ kind: z.literal('MONTHLY') }),
  RENEWAL_POLICY: z
    .object({
      windowDays: z.number().int().min(1).max(365),
      reminderDays: z.array(z.number().int().min(1).max(365)).min(1).max(10),
    })
    .superRefine((value, context) => {
      if (new Set(value.reminderDays).size !== value.reminderDays.length) {
        context.addIssue({ code: 'custom', path: ['reminderDays'], message: 'Each reminder day must be different.' });
      }
      if (value.reminderDays.some((day) => day > value.windowDays)) {
        context.addIssue({ code: 'custom', path: ['reminderDays'], message: 'A reminder cannot come before the renewal window opens.' });
      }
    }),
  /** How long a closed account keeps its holder's name, phone and email before they are replaced. */
  ACCOUNT_RETENTION: z.object({ daysAfterClosure: z.number().int().min(30).max(36_500) }),
} as const satisfies Record<RuleSettingKey, z.ZodType>;

export type RuleValue = {
  [Key in RuleSettingKey]: z.infer<(typeof schemas)[Key]>;
}[RuleSettingKey];
export type RuleValueFor<Key extends RuleSettingKey> = z.infer<(typeof schemas)[Key]>;

const defaults = {
  PIA_FLOOR: { rateBps: 400 },
  QUOTE_REPLY_DEADLINE: { days: 7 },
  NCD_POLICY: {
    validityDays: 365,
    tiers: [
      { yearsClaimFree: 1, percentage: 10 },
      { yearsClaimFree: 2, percentage: 20 },
      { yearsClaimFree: 3, percentage: 30 },
      { yearsClaimFree: 4, percentage: 40 },
      { yearsClaimFree: 5, percentage: 50 },
    ],
  },
  DRIVER_QUESTIONS: { questions: [] },
  RISK_QUESTIONS: { questions: [] },
  ADD_ON_CATALOGUE: { addOns: [] },
  USAGE_LOADINGS: {
    loadings: {
      INDIVIDUAL: 10_000,
      INDIVIDUAL_MOTORCYCLES: 10_500,
      COMMERCIAL_MOTORCYCLES: 11_800,
      COMMERCIAL_CARS_FOR_HIRE: 12_000,
      COMMERCIAL_SMALL_PUBLIC_BUSES: 12_500,
      COMMERCIAL_TRUCKS_HORSES_TRAILERS: 12_200,
      COMMERCIAL_TAXIS_YANGOS: 12_800,
      DEFAULT: 10_000,
    },
  },
  DOCUMENT_RETENTION: {
    daysByClass: {
      UNDERWRITING_EVIDENCE: 2_555,
      POLICY_EVIDENCE: 2_555,
      CLAIM_EVIDENCE: 2_555,
      BRAND_ASSET: 365,
      COMPLIANCE_EVIDENCE: 2_555,
    } satisfies Record<DocumentRetentionClass, number>,
  },
  // A provisional starter list. Compliance confirms the wording before release.
  QUOTE_DECLINE_REASONS: {
    reasons: [
      {
        code: 'OUTSIDE_APPETITE',
        customerText: 'This insurer does not offer this cover for your vehicle at the moment.',
        internalText: 'Risk is outside the insurer\'s underwriting appetite.',
      },
      {
        code: 'VEHICLE_NOT_ELIGIBLE',
        customerText: 'Your vehicle does not meet this product\'s eligibility rules.',
        internalText: 'Vehicle fails the product eligibility rules (age, value, use or type).',
      },
      {
        code: 'INFORMATION_NOT_PROVIDED',
        customerText: 'The insurer could not quote without the information it asked for.',
        internalText: 'Customer did not provide the requested information.',
      },
      {
        code: 'INSPECTION_FAILED',
        customerText: 'The vehicle did not pass the insurer\'s inspection.',
        internalText: 'Vehicle failed the underwriting inspection.',
      },
      {
        code: 'OTHER',
        customerText: 'The insurer is unable to quote for this request.',
        internalText: 'Other reason; see the internal note.',
      },
    ],
  },
  // How long before a product's reply due date its owner is warned.
  QUOTE_SLA_WARNING: { hoursBeforeDue: 24 },
  // Provisional until DEC-008. Until a version is stored, the RTSA anniversary
  // fee keeps its amount from RTSA_ANNIVERSARY_FEE_NGWEE.
  PAYMENT_CHARGES: {
    charges: [
      { code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', basis: 'FIXED', amountMinor: 0, when: 'RTSA_ANNIVERSARY' },
    ],
  },
  PAYMENT_PENDING_TIMEOUT: { minutes: 15 },
  ISSUANCE_DEADLINE: { hours: 12 },
  // Provisional until DEC-008 settles the commercial model.
  COMMISSION_RULE: { basisPoints: 0 },
  SETTLEMENT_PERIOD: { kind: 'MONTHLY' },
  // Provisional: open question 1 of the batch 15 plan.
  RENEWAL_POLICY: { windowDays: 60, reminderDays: [30, 14, 3] },
  // Provisional: open question 3 of the batch 15 plan, seven years after closure.
  ACCOUNT_RETENTION: { daysAfterClosure: 2_555 },
} as const satisfies Record<RuleSettingKey, RuleValue>;

/** Default values seed demonstrations only; a response always says whether its value is provisional. */
export function defaultRuleValue<Key extends RuleSettingKey>(key: Key): (typeof defaults)[Key] {
  return structuredClone(defaults[key]);
}

export function parseRuleValue<Key extends RuleSettingKey>(key: Key, value: unknown): { value: (typeof defaults)[Key] } | { errors: Record<string, string> } {
  const parsed = schemas[key].safeParse(value);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'value';
      errors[path] ??= issue.message;
    }
    return { errors };
  }
  return { value: parsed.data as (typeof defaults)[Key] };
}

export function isRuleSettingKey(value: string): value is RuleSettingKey {
  return (RULE_SETTING_KEYS as readonly string[]).includes(value);
}

/** Customer vehicle-use labels become stable configuration keys, not magic factors. */
export function usageKey(value: string): string {
  return value.trim().toUpperCase().replace(/&/g, 'AND').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function usageLoadingBps(value: unknown, vehicleUsage: string): number {
  const parsed = schemas.USAGE_LOADINGS.safeParse(value);
  if (!parsed.success) return 10_000;
  return parsed.data.loadings[usageKey(vehicleUsage)] ?? parsed.data.loadings.DEFAULT ?? 10_000;
}

export function calendarDay(value: string): Date | null {
  if (!CALENDAR_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
