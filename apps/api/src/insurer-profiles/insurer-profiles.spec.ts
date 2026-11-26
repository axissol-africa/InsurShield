import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { canDecideProfile } from './domain/insurer-profiles.js';
import { DecideInsurerProfileDto, InsurerProfileHistoryQueryDto, SubmitInsurerProfileDto } from './dto/insurer-profiles.dto.js';

const content = { brandName: 'Insurer', description: 'About us', serviceInformation: 'Call our service team' };
const errors = (input: object) => validateSync(plainToInstance(SubmitInsurerProfileDto, input), { whitelist: true, forbidNonWhitelisted: true });

describe('insurer-profiles validation and transitions', () => {
  it('only decides pending revisions', () => {
    expect(canDecideProfile('PENDING')).toBe(true);
    for (const status of ['APPROVED', 'REJECTED', 'SUPERSEDED'] as const) expect(canDecideProfile(status)).toBe(false);
  });
  it('accepts bounded content and optional public contacts', () => {
    expect(errors(content)).toEqual([]);
    expect(errors({ ...content, contactEmail: 'help@example.com', websiteUrl: 'https://example.com', logoUrl: null })).toEqual([]);
  });
  it.each([
    { brandName: ' ' }, { description: '' }, { serviceInformation: 'x'.repeat(4001) },
    { brandName: 'x'.repeat(161) }, { contactEmail: 'bad' }, { contactPhone: ' ' },
    { websiteUrl: 'javascript:alert(1)' }, { websiteUrl: 'http://example.com' },
    { logoUrl: 'https://user:password@example.com/image.png' }, { status: 'APPROVED' },
    { insurerId: 'another-insurer' }, { licenceNumber: 'fake' },
  ])('rejects invalid or privileged fields %j', (overrides) => {
    expect(errors({ ...content, ...overrides }).length).toBeGreaterThan(0);
  });
  it('requires an explicit decision and a nonblank bounded reason', () => {
    for (const input of [{ decision: 'APPROVE', reason: ' ' }, { decision: 'OTHER', reason: 'Reason' }, { decision: 'REJECT', reason: 'x'.repeat(2001) }]) {
      expect(validateSync(plainToInstance(DecideInsurerProfileDto, input)).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(DecideInsurerProfileDto, { decision: 'APPROVE', reason: 'Verified public details' }))).toEqual([]);
  });
  it('bounds revision history and rejects invalid cursors', () => {
    for (const input of [{ limit: 51 }, { beforeVersion: 0 }, { limit: 1.5 }]) {
      expect(validateSync(plainToInstance(InsurerProfileHistoryQueryDto, input)).length).toBeGreaterThan(0);
    }
  });
});
