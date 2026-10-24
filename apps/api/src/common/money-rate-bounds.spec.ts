import { describe, expect, it, vi } from 'vitest';
import { bpsToPercent, percentToBps } from './money.js';

vi.mock('./domain/money-limits.js', async (original) => ({
  ...(await original<typeof import('./domain/money-limits.js')>()),
  MIN_RATE_BPS: 100,
  MAX_RATE_BPS: 5000,
}));

describe('rate bounds come from money-limits.ts', () => {
  it.each([0.99, 50.01])('percentToBps refuses %s percent and names the bounds', (percent) => {
    expect(() => percentToBps(percent)).toThrow('A rate must be from 1% to 50%');
  });

  it.each([99, 5001])('bpsToPercent refuses %s basis points and names the bounds', (bps) => {
    expect(() => bpsToPercent(bps)).toThrow('A rate in basis points must be from 100 to 5000');
  });

  it('accepts the bounds themselves', () => {
    expect([percentToBps(1), percentToBps(50), bpsToPercent(100), bpsToPercent(5000)]).toEqual([100, 5000, 1, 50]);
  });
});
