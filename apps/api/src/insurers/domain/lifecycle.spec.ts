import { describe, expect, it } from 'vitest';
import { INSURER_STATUSES } from '../../common/domain/enums.js';
import { canChangeInsurerStatus } from './lifecycle.js';

describe('canChangeInsurerStatus', () => {
  it('approves an insurer that has never traded, and lets it be removed first', () => {
    expect(canChangeInsurerStatus('PENDING', 'ACTIVE')).toBe(true);
    expect(canChangeInsurerStatus('PENDING', 'DELETED')).toBe(true);
  });

  it('refuses to suspend or withdraw approval from an insurer that never had it', () => {
    expect(canChangeInsurerStatus('PENDING', 'SUSPENDED')).toBe(false);
    expect(canChangeInsurerStatus('PENDING', 'INACTIVE')).toBe(false);
  });

  it('stops, withdraws or removes an insurer that trades', () => {
    expect(canChangeInsurerStatus('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canChangeInsurerStatus('ACTIVE', 'INACTIVE')).toBe(true);
    expect(canChangeInsurerStatus('ACTIVE', 'DELETED')).toBe(true);
  });

  it('reinstates a suspended insurer, or withdraws its approval instead', () => {
    expect(canChangeInsurerStatus('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canChangeInsurerStatus('SUSPENDED', 'INACTIVE')).toBe(true);
  });

  it('never returns an insurer to never-approved, because that would lose the history', () => {
    for (const from of INSURER_STATUSES) {
      if (from === 'PENDING') continue;
      expect(canChangeInsurerStatus(from, 'PENDING'), `${from} -> PENDING`).toBe(false);
    }
  });

  it('changes a removed insurer through nothing but restore, which is not a transition here', () => {
    for (const to of INSURER_STATUSES) {
      if (to === 'DELETED') continue;
      expect(canChangeInsurerStatus('DELETED', to), `DELETED -> ${to}`).toBe(false);
    }
  });

  it('treats setting the status it already has as a no-op rather than a conflict', () => {
    for (const status of INSURER_STATUSES) {
      expect(canChangeInsurerStatus(status, status), `${status} -> ${status}`).toBe(true);
    }
  });
});
