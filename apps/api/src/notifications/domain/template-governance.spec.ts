import { validTemplateCopy } from './template-governance.js';
const mapping = {
  key: 'quote.ready',
  channel: 'EMAIL',
  category: 'QUOTE',
  mandatory: true,
};
describe('notification copy policy', () => {
  it('allows existing event placeholders in plain text', () => {
    expect(
      validTemplateCopy(
        mapping,
        'Your quote',
        '{{insurer}} has quoted. Sign in to see it.',
      ),
    ).toBe(true);
  });
  it.each([
    '{{recipient}}',
    '{{url}}',
    '{{ insurer }}',
    '{{insurer}',
    '<b>Quote</b>',
    'https://outside.example',
    'mailto:someone@example.test',
    'www.example.test',
    '//outside.example',
    '',
  ])('refuses unsafe or unknown content: %s', (body) => {
    expect(validTemplateCopy(mapping, 'Your quote', body)).toBe(false);
  });
  it('refuses header injection and oversized copy', () => {
    expect(validTemplateCopy(mapping, 'Subject\r\nBcc: other', 'Copy')).toBe(
      false,
    );
    expect(validTemplateCopy(mapping, 'Subject', 'x'.repeat(5001))).toBe(false);
  });
  it('freezes event, category, channel and mandatory behavior', () => {
    expect(
      validTemplateCopy({ ...mapping, key: 'new.event' }, 'Subject', 'Copy'),
    ).toBe(false);
    expect(
      validTemplateCopy(
        { ...mapping, category: 'MARKETING' },
        'Subject',
        'Copy',
      ),
    ).toBe(false);
    expect(
      validTemplateCopy({ ...mapping, mandatory: false }, 'Subject', 'Copy'),
    ).toBe(false);
    expect(
      validTemplateCopy(
        { ...mapping, key: 'policy.created' },
        'Subject',
        'Copy',
      ),
    ).toBe(false);
  });
  it('preserves optional renewal notifications and their established placeholders', () => {
    expect(
      validTemplateCopy(
        {
          key: 'policy.renewal_due',
          channel: 'EMAIL',
          category: 'POLICY',
          mandatory: false,
        },
        'Renew {{policyNumber}}',
        '{{insurer}} cover ends {{endDate}}, {{daysRemaining}} days left.',
      ),
    ).toBe(true);
  });
});
