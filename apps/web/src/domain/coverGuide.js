/**
 * The cover guide every insurer completes, once per cover type.
 *
 * Insurers each wrote their own policy summary, so a customer comparing two
 * quotes was comparing two documents that agreed on nothing — not the wording,
 * not the order, not even which facts were worth stating. The comparison page
 * went as far as matching free text with regular expressions to force rows to
 * line up, which works until an insurer writes "windscreen" differently.
 *
 * This schema is the fix, and it is deliberately fixed: the same questions in
 * the same order for everyone, so the customer-facing document can be rendered
 * identically whoever wrote it and two policies can be read side by side. It
 * drives the insurer's form, its validation, the customer's document and the
 * comparison table from one place — a field added here appears in all four.
 */

export const COVER_TYPES = ['Comprehensive', 'ThirdParty'];

export const COVER_TYPE_LABELS = {
  Comprehensive: 'Comprehensive',
  ThirdParty: 'Third party only',
};

/**
 * Sections in the order a customer reads them: what this is, what it buys,
 * what it does not, what happens when they claim, what is expected of them,
 * and how long the offer stands.
 *
 * Deliberately short. Every question here is one a customer would ask out
 * loud, and nothing is asked twice — benefit limits live against the benefits
 * themselves rather than in a second list, and whether a vehicle needs
 * inspecting is settled during the quote request, not here.
 */
export const COVER_GUIDE_SECTIONS = [
  {
    id: 'plan',
    title: 'The plan',
    hint: 'How this policy is named and sold.',
    fields: [
      { key: 'planName', label: 'Plan name', kind: 'text', required: true, max: 60, placeholder: 'e.g. Comprehensive Gold' },
      { key: 'summary', label: 'One-line summary', kind: 'long', required: true, max: 240, placeholder: 'What this policy is, in a sentence a customer would use.' },
    ],
  },
  {
    id: 'covered',
    title: 'What is covered',
    hint: 'These become the rows a customer compares across insurers.',
    fields: [
      { key: 'coveredItems', label: 'Covered benefits', kind: 'list', required: true, minItems: 1, max: 20, placeholder: 'e.g. Medical expenses up to ZMW 50,000' },
    ],
  },
  {
    id: 'excluded',
    title: 'What is not covered',
    hint: 'The exclusions a customer would be upset to discover at claim time.',
    fields: [
      { key: 'exclusions', label: 'Exclusions', kind: 'list', required: true, minItems: 1, max: 20, placeholder: 'e.g. Driving without a valid licence' },
    ],
  },
  {
    id: 'claims',
    title: 'Making a claim',
    hint: 'What the customer must do, and how quickly.',
    fields: [
      { key: 'notifyWithinDays', label: 'Notify the insurer within', kind: 'days', required: true, max: 90 },
      { key: 'howToNotify', label: 'How to notify a claim', kind: 'long', required: true, max: 300, placeholder: 'e.g. Call the claims line, then submit the form within 48 hours.' },
      { key: 'documentsRequired', label: 'Documents needed', kind: 'list', required: true, minItems: 1, max: 15, placeholder: 'e.g. Police report' },
      { key: 'claimsContact', label: 'Claims contact', kind: 'text', required: true, max: 120, placeholder: 'e.g. +260 211 255 100 · claims@insurer.zm' },
      { key: 'settlementTime', label: 'Typical settlement time', kind: 'text', required: true, max: 60, placeholder: 'e.g. 14 working days from complete documents' },
    ],
  },
  {
    id: 'conditions',
    title: 'Conditions',
    hint: 'What is expected of the policyholder for cover to hold.',
    fields: [
      { key: 'territorialLimit', label: 'Where the cover applies', kind: 'text', required: true, max: 120, placeholder: 'e.g. Zambia, and SADC countries on request' },
      { key: 'ncdAccepted', label: 'No-claim discount accepted', kind: 'boolean' },
    ],
  },
  {
    id: 'validity',
    title: 'Validity',
    hint: 'How long a quote on this plan stands.',
    fields: [
      { key: 'quoteValidityDays', label: 'Quote valid for', kind: 'days', required: true, max: 90 },
    ],
  },
];

/**
 * Every field, flattened. Both cover types answer the same questions — what
 * differs between comprehensive and third party is the answers, above all the
 * list of what is covered.
 */
export const fieldsFor = () => COVER_GUIDE_SECTIONS.flatMap((section) => section.fields);

/** The sections, as the form and the document both lay them out. */
export const sectionsFor = () => COVER_GUIDE_SECTIONS;

const EMPTY = { list: () => [], boolean: () => false, days: () => '', text: () => '', long: () => '' };

/** A guide with every applicable field present and empty, ready to edit. */
export function blankCoverGuide(coverType) {
  const guide = { coverType };
  for (const field of fieldsFor()) guide[field.key] = EMPTY[field.kind]();
  return guide;
}

/**
 * Split a benefit line into the thing covered and what this insurer says about
 * it: "Medical Expenses up to ZMW 50,000" is the same benefit as "Medical
 * Expenses up to ZMW 30,000", at a different ceiling.
 *
 * Without this every insurer's wording became its own row, so comparing five
 * insurers grew five medical-expenses rows with one tick each — the opposite
 * of comparing.
 */
export function splitBenefit(line) {
  const text = String(line ?? '').trim();
  const match = text.match(/^(.*?)\s*(?:—|-|:)\s*(.+)$/) || text.match(/^(.*?)\s+(up to\s+.+)$/i);
  return match ? { name: match[1].trim(), detail: match[2].trim() } : { name: text, detail: '' };
}

/**
 * Benefits share a row when they name the same thing. "&" and "and" are the
 * same word to a reader, so they are the same word here.
 */
export const benefitKey = (line) => splitBenefit(line).name
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Lines from a list field, tolerating guides published when a benefit was a
 * benefit and a separate limit.
 */
export const asLines = (value) => (value || [])
  .map((entry) => (typeof entry === 'string' ? entry : [entry?.item, entry?.limit].filter(Boolean).join(' — ')))
  .map((line) => String(line ?? '').trim())
  .filter(Boolean);

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Whether one field has been answered. A `boolean` is always answered —
 * "no-claim discount not accepted" is an answer — which is why it is never
 * `required` and never counts as missing.
 */
export function fieldAnswered(field, value) {
  if (field.kind === 'boolean') return true;
  if (field.kind === 'list') return asLines(value).length >= (field.minItems ?? 1);
  return !isBlank(value);
}

/**
 * Check a guide against the schema.
 *
 * @returns {{ valid: boolean, errors: Record<string,string> }}
 */
export function validateCoverGuide(guide = {}) {
  const errors = {};
  for (const field of fieldsFor()) {
    const value = guide[field.key];
    const answered = fieldAnswered(field, value);

    if (field.required && !answered) {
      errors[field.key] = field.kind === 'list'
        ? `Add at least ${field.minItems ?? 1} to “${field.label}”.`
        : `“${field.label}” is needed.`;
      continue;
    }
    if (!answered) continue;

    if ((field.kind === 'text' || field.kind === 'long') && field.max && value.trim().length > field.max) {
      errors[field.key] = `“${field.label}” cannot be longer than ${field.max} characters.`;
    }
    if (field.kind === 'days') {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > field.max) {
        errors[field.key] = `“${field.label}” must be between 1 and ${field.max} days.`;
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** How much of the guide is filled in, for the progress a form shows. */
export function coverGuideCompleteness(guide = {}) {
  const counted = fieldsFor().filter((field) => field.kind !== 'boolean');
  const done = counted.filter((field) => fieldAnswered(field, guide[field.key])).length;
  return { done, total: counted.length, percent: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

/** A guide an insurer may publish: every required field answered and valid. */
export const isCoverGuideComplete = (guide) => Boolean(guide) && validateCoverGuide(guide).valid;

/** Drop blank rows and tidy whitespace, so what is stored is what was meant. */
export function cleanCoverGuide(guide = {}, coverType) {
  const cleaned = { coverType };
  for (const field of fieldsFor()) {
    const value = guide[field.key];
    if (field.kind === 'list') cleaned[field.key] = asLines(value);
    else if (field.kind === 'boolean') cleaned[field.key] = Boolean(value);
    else if (typeof value === 'string') cleaned[field.key] = value.trim();
    else cleaned[field.key] = value ?? '';
  }
  return cleaned;
}
