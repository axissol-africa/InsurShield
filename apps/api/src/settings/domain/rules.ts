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

const declineReason = z.object({
  code: z.string().regex(QUESTION_CODE),
  customerText: z.string().trim().min(2).max(500),
  internalText: z.string().trim().min(2).max(1_000),
});

const quoteDeclineReasons = z.object({
  reasons: z.array(declineReason).min(1).max(100),
}).superRefine((value, context) => {
  const codes = value.reasons.map((reason) => reason.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: 'Each decline reason must use a different code.' });
  }
});

const inspectionEvidenceSlot = z.object({
  code: z.string().regex(QUESTION_CODE),
  label: z.string().trim().min(2).max(120),
});

const inspectionEvidenceSlots = z.object({
  slots: z.array(inspectionEvidenceSlot).min(1).max(20),
}).superRefine((value, context) => {
  const codes = value.slots.map((slot) => slot.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: 'custom', path: ['slots'], message: 'Each inspection slot must use a different code.' });
  }
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
  QUOTE_DECLINE_REASONS: quoteDeclineReasons,
  QUOTE_SLA_WARNING: z.object({ hoursBeforeDue: z.number().int().min(1).max(720) }),
  INSPECTION_EVIDENCE_SLOTS: inspectionEvidenceSlots,
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
  QUOTE_DECLINE_REASONS: {
    reasons: [
      {
        code: 'UNDERWRITING_DECLINED',
        customerText: 'This cover cannot be offered for the vehicle and details supplied.',
        internalText: 'The underwriting assessment did not meet the insurer’s acceptance criteria.',
      },
      {
        code: 'INFORMATION_NOT_PROVIDED',
        customerText: 'The information needed to complete this quote was not provided in time.',
        internalText: 'The customer did not provide the requested underwriting information by the due date.',
      },
      {
        code: 'INSPECTION_FAILED',
        customerText: 'The vehicle inspection did not meet the requirements for this cover.',
        internalText: 'The inspection was failed by the insurer or its appointed inspector.',
      },
    ],
  },
  QUOTE_SLA_WARNING: { hoursBeforeDue: 24 },
  INSPECTION_EVIDENCE_SLOTS: {
    slots: [
      { code: 'FRONT', label: 'Front view' },
      { code: 'REAR', label: 'Rear view' },
      { code: 'LEFT', label: 'Left side' },
      { code: 'RIGHT', label: 'Right side' },
      { code: 'DASHBOARD_OR_MILEAGE', label: 'Dashboard or mileage' },
      { code: 'ENGINE_BAY', label: 'Engine bay' },
    ],
  },
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
