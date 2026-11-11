import { describe, expect, it } from 'vitest';
import { activationBlocks, describeBlocks, type EvidenceOnFile } from './onboarding.js';

const NOW = new Date('2026-11-11T09:00:00.000Z');
const approved = (kind: EvidenceOnFile['kind'], expiresAt: Date | null = null): EvidenceOnFile => ({
  kind,
  state: 'APPROVED',
  expiresAt,
});

describe('activationBlocks', () => {
  it('admits an insurer whose licence is approved and current', () => {
    expect(activationBlocks([approved('LICENCE', new Date('2027-01-01'))], NOW)).toEqual([]);
  });

  it('admits a licence with no expiry recorded, since nothing has lapsed', () => {
    expect(activationBlocks([approved('LICENCE')], NOW)).toEqual([]);
  });

  it('refuses an insurer with nothing on file, naming what is missing', () => {
    expect(activationBlocks([], NOW)).toEqual([{ reason: 'MISSING', kind: 'LICENCE' }]);
  });

  it('refuses a licence nobody has approved', () => {
    expect(activationBlocks([{ kind: 'LICENCE', state: 'PENDING', expiresAt: null }], NOW)).toEqual([
      { reason: 'UNAPPROVED', kind: 'LICENCE' },
    ]);
  });

  it('refuses a licence that lapsed yesterday in Lusaka', () => {
    expect(activationBlocks([approved('LICENCE', new Date('2026-11-10T00:00:00.000Z'))], NOW)).toEqual([
      { reason: 'EXPIRED', kind: 'LICENCE' },
    ]);
  });

  it('accepts a licence on the day it lapses, which it holds until the end of', () => {
    expect(activationBlocks([approved('LICENCE', new Date('2026-11-11T00:00:00.000Z'))], NOW)).toEqual([]);
  });

  it('refuses over a document nobody required but which is in order no longer', () => {
    const blocks = activationBlocks(
      [approved('LICENCE'), approved('TAX_CLEARANCE', new Date('2020-01-01'))],
      NOW,
    );

    expect(blocks).toEqual([{ reason: 'EXPIRED', kind: 'TAX_CLEARANCE' }]);
  });

  it('answers with every reason at once, so one fix does not reveal the next', () => {
    const blocks = activationBlocks(
      [
        { kind: 'AGREEMENT', state: 'PENDING', expiresAt: null },
        approved('TAX_CLEARANCE', new Date('2020-01-01')),
      ],
      NOW,
    );

    expect(blocks).toEqual([
      { reason: 'MISSING', kind: 'LICENCE' },
      { reason: 'UNAPPROVED', kind: 'AGREEMENT' },
      { reason: 'EXPIRED', kind: 'TAX_CLEARANCE' },
    ]);
  });

  it('does not call an unapproved document expired as well, which would read as two faults', () => {
    const blocks = activationBlocks(
      [approved('LICENCE'), { kind: 'AGREEMENT', state: 'REJECTED', expiresAt: new Date('2020-01-01') }],
      NOW,
    );

    expect(blocks).toEqual([{ reason: 'UNAPPROVED', kind: 'AGREEMENT' }]);
  });
});

describe('describeBlocks', () => {
  it('names each reason in words an administrator can act on', () => {
    expect(describeBlocks(activationBlocks([], NOW))).toBe('no licence on file');
    expect(
      describeBlocks(
        activationBlocks([approved('LICENCE'), approved('TAX_CLEARANCE', new Date('2020-01-01'))], NOW),
      ),
    ).toBe('an expired tax clearance');
  });

  it('says a repeated reason once', () => {
    const blocks = activationBlocks(
      [
        { kind: 'OTHER', state: 'PENDING', expiresAt: null },
        { kind: 'OTHER', state: 'PENDING', expiresAt: null },
        approved('LICENCE'),
      ],
      NOW,
    );

    expect(describeBlocks(blocks)).toBe('an unapproved supporting document');
  });
});
