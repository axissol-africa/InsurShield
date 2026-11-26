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


it('clears pending commands on sign-out or a different account, while preserving same-account retries', () => {
  setIdentityBinding('owner-a');
  sessionStorage.setItem('insurshield:pending-command:ncd', 'pending');
  sessionStorage.setItem('unrelated', 'keep');
  setIdentityBinding('owner-a');
  expect(sessionStorage.getItem('insurshield:pending-command:ncd')).toBe('pending');
  setIdentityBinding('owner-b');
  expect(sessionStorage.getItem('insurshield:pending-command:ncd')).toBeNull();
  sessionStorage.setItem('insurshield:pending-command:quote', 'pending');
  clearIdentityBinding();
  expect(sessionStorage.getItem('insurshield:pending-command:quote')).toBeNull();
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
});
