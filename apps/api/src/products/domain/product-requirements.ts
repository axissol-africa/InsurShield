import type { DocumentKind } from '../../common/domain/enums.js';

export const PRODUCT_REQUIREMENT_KINDS = ['QUESTION', 'DOCUMENT', 'DECLARATION'] as const;
export type ProductRequirementKind = (typeof PRODUCT_REQUIREMENT_KINDS)[number];

export const QUESTION_INPUT_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT'] as const;
export type QuestionInputType = (typeof QUESTION_INPUT_TYPES)[number];

/** Only document categories a customer may reasonably upload before a quote. */
export const PRODUCT_REQUIREMENT_DOCUMENT_KINDS = ['WHITE_BOOK', 'NCD_EVIDENCE', 'CLAIM_ATTACHMENT'] as const satisfies readonly DocumentKind[];
export type ProductRequirementDocumentKind = (typeof PRODUCT_REQUIREMENT_DOCUMENT_KINDS)[number];

export type ProductRequirementConfig =
  | { inputType: 'TEXT' | 'NUMBER' | 'BOOLEAN' }
  | { inputType: 'SELECT'; options: string[] }
  | { documentKind: ProductRequirementDocumentKind }
  | { text: string };

export interface ProductRequirementDefinition {
  productVersionId: string;
  key: string;
  kind: ProductRequirementKind;
  label: string;
  helpText: string | null;
  required: boolean;
  config: ProductRequirementConfig;
  displayOrder: number;
}

export interface ProductRequirementInput {
  key: string;
  kind: ProductRequirementKind;
  label: string;
  helpText?: string | null;
  required?: boolean;
  config: Record<string, unknown>;
  displayOrder?: number;
}

export interface ProductRequirementCheck {
  requirements: Omit<ProductRequirementDefinition, 'productVersionId'>[];
  errors: Record<string, string>;
}

type RecordValue = Record<string, unknown>;

const KEY = /^[a-z][a-z0-9_]{1,79}$/;
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: RecordValue, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const cleanText = (value: unknown, maximum: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum ? value.trim() : null;

/**
 * Normalises product-requirement definitions at the insurer boundary. The
 * configuration is small, explicit, and typed by kind so it can later be
 * validated at quote submission without evaluating arbitrary rules.
 */
export function checkProductRequirements(value: unknown): ProductRequirementCheck {
  const errors: Record<string, string> = {};
  if (!Array.isArray(value)) return { requirements: [], errors: { requirements: 'Provide requirements as a list.' } };
  if (value.length > 30) return { requirements: [], errors: { requirements: 'Use no more than 30 product requirements.' } };

  const seen = new Set<string>();
  const requirements: Omit<ProductRequirementDefinition, 'productVersionId'>[] = [];

  value.forEach((raw, index) => {
    const path = `requirements.${index}`;
    if (!isRecord(raw)) {
      errors[path] = 'Each requirement must be an object.';
      return;
    }
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    const kind = raw.kind;
    const label = cleanText(raw.label, 160);
    const helpText = raw.helpText === undefined || raw.helpText === null ? null : cleanText(raw.helpText, 500);
    const required = raw.required === undefined ? true : raw.required;
    const displayOrder = raw.displayOrder === undefined ? index : raw.displayOrder;

    if (!KEY.test(key)) errors[`${path}.key`] = 'Use a lowercase key of letters, numbers and underscores.';
    else if (seen.has(key)) errors[`${path}.key`] = 'Use each requirement key only once.';
    else seen.add(key);
    if (!PRODUCT_REQUIREMENT_KINDS.includes(kind as ProductRequirementKind)) errors[`${path}.kind`] = 'Choose question, document or declaration.';
    if (!label) errors[`${path}.label`] = 'Enter a label of up to 160 characters.';
    if (raw.helpText !== undefined && raw.helpText !== null && !helpText) errors[`${path}.helpText`] = 'Enter help text of up to 500 characters.';
    if (typeof required !== 'boolean') errors[`${path}.required`] = 'State whether this requirement is required.';
    if (!Number.isInteger(displayOrder) || (displayOrder as number) < 0 || (displayOrder as number) > 999) {
      errors[`${path}.displayOrder`] = 'Use an order from 0 to 999.';
    }
    if (!isRecord(raw.config)) {
      errors[`${path}.config`] = 'Provide a valid requirement configuration.';
      return;
    }
    const config = checkRequirementConfig(kind as ProductRequirementKind, raw.config, path, errors);
    if (!key || !label || !config || typeof required !== 'boolean' || !Number.isInteger(displayOrder) || (displayOrder as number) < 0 || (displayOrder as number) > 999) return;
    requirements.push({ key, kind: kind as ProductRequirementKind, label, helpText, required, config, displayOrder: displayOrder as number });
  });

  return { requirements, errors };
}

function checkRequirementConfig(
  kind: ProductRequirementKind,
  config: RecordValue,
  path: string,
  errors: Record<string, string>,
): ProductRequirementConfig | null {
  if (kind === 'QUESTION') {
    const inputType = config.inputType;
    if (!QUESTION_INPUT_TYPES.includes(inputType as QuestionInputType)) {
      errors[`${path}.config.inputType`] = 'Choose text, number, boolean or select.';
      return null;
    }
    if (inputType === 'SELECT') {
      if (!hasOnly(config, ['inputType', 'options']) || !Array.isArray(config.options) || config.options.length < 1 || config.options.length > 30) {
        errors[`${path}.config`] = 'A select question needs 1 to 30 options.';
        return null;
      }
      const options = config.options.map((option) => cleanText(option, 100));
      if (options.some((option) => !option) || new Set(options).size !== options.length) {
        errors[`${path}.config.options`] = 'Select options must be unique text values of up to 100 characters.';
        return null;
      }
      return { inputType: 'SELECT', options: options as string[] };
    }
    if (!hasOnly(config, ['inputType'])) {
      errors[`${path}.config`] = 'This question type does not accept extra configuration.';
      return null;
    }
    return { inputType: inputType as Exclude<QuestionInputType, 'SELECT'> };
  }

  if (kind === 'DOCUMENT') {
    const documentKind = config.documentKind;
    if (!hasOnly(config, ['documentKind']) || !PRODUCT_REQUIREMENT_DOCUMENT_KINDS.includes(documentKind as ProductRequirementDocumentKind)) {
      errors[`${path}.config.documentKind`] = 'Choose a customer-uploadable document kind.';
      return null;
    }
    return { documentKind: documentKind as ProductRequirementDocumentKind };
  }

  if (kind === 'DECLARATION') {
    const text = cleanText(config.text, 2_000);
    if (!hasOnly(config, ['text']) || !text) {
      errors[`${path}.config.text`] = 'Enter the declaration text (up to 2,000 characters).';
      return null;
    }
    return { text };
  }

  errors[`${path}.kind`] = 'Choose question, document or declaration.';
  return null;
}

/** Parses requirements read from the database with the same strict rules. */
export function requirementFromStored(row: {
  productVersionId: string;
  key: string;
  kind: string;
  label: string;
  helpText: string | null;
  required: boolean;
  config: Record<string, unknown>;
  displayOrder: number;
}): ProductRequirementDefinition | null {
  const checked = checkProductRequirements([row]);
  const [requirement] = checked.requirements;
  return Object.keys(checked.errors).length === 0 && requirement ? { ...requirement, productVersionId: row.productVersionId } : null;
}

/** A group can share a single answer only when the terms are truly identical. */
export function requirementSignature(requirement: ProductRequirementDefinition): string {
  return JSON.stringify({
    key: requirement.key,
    kind: requirement.kind,
    label: requirement.label,
    helpText: requirement.helpText,
    required: requirement.required,
    config: requirement.config,
  });
}

export function validateQuestionAnswer(requirement: ProductRequirementDefinition, raw: unknown): string | number | boolean | null {
  if (requirement.kind !== 'QUESTION') return null;
  const config = requirement.config as Extract<ProductRequirementConfig, { inputType: QuestionInputType }>;
  switch (config.inputType) {
    case 'TEXT': {
      const value = cleanText(raw, 500);
      return value;
    }
    case 'NUMBER': {
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(raw.trim()) ? Number(raw) : NaN;
      return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000 ? value : null;
    }
    case 'BOOLEAN':
      return typeof raw === 'boolean' ? raw : null;
    case 'SELECT':
      return typeof raw === 'string' && config.options.includes(raw) ? raw : null;
  }
}
