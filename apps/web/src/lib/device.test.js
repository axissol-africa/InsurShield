import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileDevice } from './device';

const withUserAgent = (userAgent, userAgentData) => {
  vi.stubGlobal('navigator', { userAgent, userAgentData });
};

afterEach(() => vi.unstubAllGlobals());

describe('isMobileDevice', () => {
  it('detects phones and tablets from the user agent', () => {
    withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(isMobileDevice()).toBe(true);
    withUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    expect(isMobileDevice()).toBe(true);
  });
  it('prefers the client-hints mobile flag when present', () => {
    withUserAgent('Mozilla/5.0 (Windows NT 10.0)', { mobile: true });
    expect(isMobileDevice()).toBe(true);
  });
  it('treats desktop browsers as not mobile', () => {
    withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/128', { mobile: false });
    expect(isMobileDevice()).toBe(false);
  });
});
