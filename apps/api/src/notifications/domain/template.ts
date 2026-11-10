/** Choosing which version of a template to use, and filling it in. */

export interface TemplateVersion {
  key: string;
  version: number;
  subject: string;
  body: string;
  mandatory: boolean;
  activeFrom: Date | null;
}

/**
 * The newest version already in use at `at`.
 *
 * Resolved by the time the message is generated rather than by "the latest
 * row", so a template published for next week does not quietly start sending
 * today, and a message generated before an edit keeps the wording it was sent
 * with when it is read back.
 */
export function activeVersion<T extends TemplateVersion>(versions: T[], at: Date): T | undefined {
  return versions
    .filter((candidate) => candidate.activeFrom !== null && candidate.activeFrom <= at)
    .sort((a, b) => b.version - a.version)[0];
}

/**
 * Replaces `{{name}}` with the value given for it.
 *
 * A placeholder with no value is left as it is rather than blanked: a message
 * reading "Your quote from {{insurer}} is ready" is wrong in a way somebody
 * will report, while one reading "Your quote from  is ready" looks like a
 * typo and can survive for months.
 */
export function render(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The placeholders a template asks for, so a caller can be checked against it. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))];
}
