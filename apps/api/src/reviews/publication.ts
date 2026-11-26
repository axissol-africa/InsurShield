import { ApiException } from '../common/errors/api.exception.js';

/** A second check beside human moderation for common direct identifiers. */
export function assertReviewPublicText(text: string | null, policyNumber: string): void {
  const content = text?.toLowerCase() ?? '';
  if (content.includes(policyNumber.toLowerCase()) || /[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+?260|0)[\s()\d-]{8,}/i.test(content)) {
    throw new ApiException('REVIEW_IDENTIFYING_INFORMATION', 'Remove contact or policy information before publishing.');
  }
}
