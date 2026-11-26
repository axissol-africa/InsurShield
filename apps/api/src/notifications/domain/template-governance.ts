import { TEMPLATE_POLICIES } from './template-policy.js';
import { placeholders } from './template.js';

export function validTemplateCopy(
  mapping: {
    key: string;
    channel: string;
    category: string;
    mandatory: boolean;
  },
  subject: string,
  body: string,
): boolean {
  const policy = TEMPLATE_POLICIES[`${mapping.key}:${mapping.channel}`];
  if (
    !policy ||
    policy.category !== mapping.category ||
    policy.mandatory !== mapping.mandatory
  )
    return false;
  if (
    !subject.trim() ||
    subject.length > 200 ||
    /[\r\n]/.test(subject) ||
    !body.trim() ||
    body.length > 5000
  )
    return false;
  const copy = `${subject}\n${body}`;
  // Links remain the authenticated application's responsibility, never editable message content.
  for (let index = 0; index < copy.length; index += 1) {
    const code = copy.charCodeAt(index);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) return false;
  }
  if (
    /[<>]|(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|javascript:|data:|\/\/)/i.test(
      copy,
    )
  )
    return false;
  if (/[{}]/.test(copy.replace(/\{\{\w+\}\}/g, ''))) return false;
  return placeholders(copy).every((name) => policy.placeholders.includes(name));
}
