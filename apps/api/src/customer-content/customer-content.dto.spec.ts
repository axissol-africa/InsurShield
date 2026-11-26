import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContentSlugDto, CreateContentDto, WithdrawContentDto } from './customer-content.dto.js';
const payload = { type: 'FAQ', title: 'A question', body: 'An answer', effectiveFrom: '2026-02-28', expectedVersion: 0 };
describe('customer content boundary validation', () => {
  it('accepts date-only leap days and trims wording', async () => {
    const dto = plainToInstance(CreateContentDto, { ...payload, effectiveFrom: '2028-02-29', title: ' A question ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.title).toBe('A question');
  });
  it.each([
    { effectiveFrom: '2026-02-29' }, { effectiveFrom: '2026-04-31' },
    { effectiveFrom: '2026-01-01T00:00:00Z' }, { effectiveFrom: '26-01-01' },
    { expiresOn: '2026-02-30' }, { type: 'POLICY' }, { title: '   ' },
    { body: ' ' }, { body: 'x'.repeat(20001) }, { expectedVersion: -1 }, { expectedVersion: 0.5 },
  ])('rejects malformed content %j', async overrides => {
    expect((await validate(plainToInstance(CreateContentDto, { ...payload, ...overrides }))).length).toBeGreaterThan(0);
  });
  it('requires a bounded reason and canonical slug', async () => {
    expect((await validate(plainToInstance(WithdrawContentDto, { reason: '   ' }))).length).toBeGreaterThan(0);
    for (const slug of ['a/b', 'UPPERCASE', '-prefix', 'x'.repeat(101)]) {
      expect((await validate(plainToInstance(ContentSlugDto, { slug }))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(ContentSlugDto, { slug: 'claims-faq-2' }))).toEqual([]);
  });
});
