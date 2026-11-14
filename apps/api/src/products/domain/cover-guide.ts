/**
 * The API-owned representation of the fixed comparison guide. The client may
 * render it however it needs to, but the boundary validates it here so a
 * direct API caller cannot publish a half-filled or differently shaped guide.
 */
export interface CoverGuide {
  planName?: string;
  summary?: string;
  coveredItems?: string[];
  exclusions?: string[];
  notifyWithinDays?: number;
  howToNotify?: string;
  documentsRequired?: string[];
  claimsContact?: string;
  settlementTime?: string;
  territorialLimit?: string;
  ncdAccepted?: boolean;
  quoteValidityDays?: number;
}

export interface CoverGuideCheck {
  guide: CoverGuide;
  errors: Record<string, string>;
}

type StringField = Exclude<keyof CoverGuide, 'coveredItems' | 'exclusions' | 'documentsRequired' | 'ncdAccepted' | 'notifyWithinDays' | 'quoteValidityDays'>;

const STRING_LIMITS: Record<StringField, number> = {
  planName: 60,
  summary: 240,
  howToNotify: 300,
  claimsContact: 120,
  settlementTime: 60,
  territorialLimit: 120,
};
const LIST_LIMITS = { coveredItems: 20, exclusions: 20, documentsRequired: 15 } as const;
const REQUIRED: readonly (keyof CoverGuide)[] = [
  'planName',
  'summary',
  'coveredItems',
  'exclusions',
  'notifyWithinDays',
  'howToNotify',
  'documentsRequired',
  'claimsContact',
  'settlementTime',
  'territorialLimit',
  'quoteValidityDays',
];
const ALLOWED = new Set<keyof CoverGuide>([...Object.keys(STRING_LIMITS), ...Object.keys(LIST_LIMITS), 'ncdAccepted', 'notifyWithinDays', 'quoteValidityDays'] as (keyof CoverGuide)[]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const words = (field: string) => field.replace(/([A-Z])/g, ' $1').toLowerCase();

/** Normalises a draft and returns field-level feedback without throwing. */
export function checkCoverGuide(value: unknown, requireComplete: boolean): CoverGuideCheck {
  const errors: Record<string, string> = {};
  const guide: CoverGuide = {};
  if (!isRecord(value)) return { guide, errors: { coverGuide: 'Provide the cover guide as an object.' } };

  for (const key of Object.keys(value)) {
    if (!ALLOWED.has(key as keyof CoverGuide)) errors[key] = 'This is not a supported cover-guide field.';
  }

  for (const [key, maximum] of Object.entries(STRING_LIMITS) as [StringField, number][]) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') {
      errors[key] = `Enter ${words(key)} as text.`;
      continue;
    }
    const clean = raw.trim();
    if (clean.length > maximum) errors[key] = `${words(key)} cannot be longer than ${maximum} characters.`;
    else guide[key] = clean;
  }

  for (const [key, maximum] of Object.entries(LIST_LIMITS) as [keyof Pick<CoverGuide, 'coveredItems' | 'exclusions' | 'documentsRequired'>, number][]) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      errors[key] = `Enter ${words(key)} as a list.`;
      continue;
    }
    const clean = raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
    if (clean.length !== raw.filter((item) => item !== '').length) errors[key] = `Each ${words(key)} entry must be text.`;
    else if (clean.length > maximum) errors[key] = `Add no more than ${maximum} ${words(key)}.`;
    else if (clean.some((item) => item.length > 240)) errors[key] = `Each ${words(key)} entry must be 240 characters or fewer.`;
    else guide[key] = clean;
  }

  for (const key of ['notifyWithinDays', 'quoteValidityDays'] as const) {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const number = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(number) || number < 1 || number > 90) errors[key] = `${words(key)} must be a whole number from 1 to 90.`;
    else guide[key] = number;
  }

  if (value.ncdAccepted !== undefined && typeof value.ncdAccepted !== 'boolean') {
    errors.ncdAccepted = 'State whether a no-claim discount is accepted.';
  } else if (typeof value.ncdAccepted === 'boolean') {
    guide.ncdAccepted = value.ncdAccepted;
  }

  if (requireComplete) {
    for (const field of REQUIRED) {
      const item = guide[field];
      if (item === undefined || item === '' || (Array.isArray(item) && item.length === 0)) {
        errors[field] ??= `Complete ${words(field)} before submitting this guide.`;
      }
    }
    if (guide.ncdAccepted === undefined) errors.ncdAccepted = 'State whether a no-claim discount is accepted.';
  }
  return { guide, errors };
}

export function completeCoverGuide(value: unknown): CoverGuide {
  const checked = checkCoverGuide(value, true);
  if (Object.keys(checked.errors).length > 0) throw new Error('A complete cover guide was expected.');
  return checked.guide;
}
