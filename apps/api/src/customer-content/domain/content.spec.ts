import { plainText, publishedVersions, transitionAllowed, type PublicationVersion } from './content.js';
const version = (overrides: Partial<PublicationVersion> = {}): PublicationVersion => ({
  slug: 'claims-help', version: 1, status: 'APPROVED', effectiveFrom: '2026-01-01', expiresOn: null,
  approvedAt: new Date('2026-01-01'), ...overrides,
});
describe('governed publication', () => {
  it('does not revive older wording when the latest effective approved version expires', () => {
    expect(publishedVersions([version(), version({ version: 2, expiresOn: '2026-03-01' })], '2026-03-02')).toEqual([]);
  });
  it('keeps current copy while a later draft or scheduled approval awaits publication', () => {
    expect(publishedVersions([version(), version({ version: 2, status: 'DRAFT', approvedAt: null }),
      version({ version: 3, effectiveFrom: '2027-01-01' })], '2026-03-02')).toEqual([version()]);
  });
  it('withdrawn approvals tombstone previous copy, including a withdrawn scheduled version', () => {
    expect(publishedVersions([version(), version({ version: 2, status: 'WITHDRAWN', effectiveFrom: '2027-01-01' })], '2026-03-02')).toEqual([]);
  });
  it('withdrawn drafts do not retire an approved publication', () => {
    expect(publishedVersions([version(), version({ version: 2, status: 'WITHDRAWN', approvedAt: null })], '2026-03-02')).toEqual([version()]);
  });
  it('publishes on the effective day and includes the entire expiry day', () => {
    const row = version({ effectiveFrom: '2026-03-02', expiresOn: '2026-03-02' });
    expect(publishedVersions([row], '2026-03-01')).toEqual([]);
    expect(publishedVersions([row], '2026-03-02')).toEqual([row]);
    expect(publishedVersions([row], '2026-03-03')).toEqual([]);
  });
  it('keeps slug streams independent and chooses by version regardless of row order', () => {
    const newest = version({ version: 2 });
    const other = version({ slug: 'other' });
    expect(publishedVersions([newest, other, version()], '2026-03-02')).toEqual([newest, other]);
  });
  it('only approves drafts and never restores withdrawn versions', () => {
    expect(transitionAllowed('DRAFT', 'approve')).toBe(true);
    expect(transitionAllowed('APPROVED', 'approve')).toBe(false);
    expect(transitionAllowed('WITHDRAWN', 'approve')).toBe(false);
    expect(transitionAllowed('WITHDRAWN', 'withdraw')).toBe(false);
    expect(transitionAllowed('APPROVED', 'withdraw')).toBe(true);
  });
  it('accepts ordinary plain text but rejects HTML, blank copy and control characters', () => {
    expect(plainText('Cost < 100\nAsk your insurer.')).toBe(true);
    for (const text of [' ', '<script>alert(1)</script>', '<a href="evil">link</a>', '\u0000']) expect(plainText(text)).toBe(false);
  });
});
