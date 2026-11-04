import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));

import {
  IDENTITY_STORAGE_KEY,
  clearIdentityBinding,
  getIdentityBinding,
  safeApplicationPath,
  setIdentityBinding,
} from './identity';

beforeEach(() => window.sessionStorage.clear());

describe('HTTP tab identity binding', () => {
  it('keeps the trusted identity in session storage and removes it on transition', () => {
    setIdentityBinding('user-123');

    expect(window.sessionStorage.getItem(IDENTITY_STORAGE_KEY)).toBe('user-123');
    expect(getIdentityBinding()).toBe('user-123');

    clearIdentityBinding();
    expect(getIdentityBinding()).toBeNull();
  });

  it('accepts only local application paths after sign-in', () => {
    expect(safeApplicationPath('/account?section=policies')).toBe('/account?section=policies');
    expect(safeApplicationPath('//outside.example')).toBe('/account');
    expect(safeApplicationPath('https://outside.example')).toBe('/account');
    expect(safeApplicationPath('/\\outside.example')).toBe('/account');
  });
});
