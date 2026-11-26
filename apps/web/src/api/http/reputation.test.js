import { beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: transport }));
import { badgeGovernance, insurerReputation } from './index';
import { badgeGovernance as mockBadgeGovernance } from '../mock';

beforeEach(() => vi.resetAllMocks());

it('uses the batched endpoint and forwards cancellation', () => {
  const signal = new AbortController().signal;
  insurerReputation.list(['first', 'second'], { signal });
  expect(transport.get).toHaveBeenCalledWith('/insurer-reputation', { signal, params: { insurerIds: 'first,second' } });
});

it('uses the authenticated adapter for badge governance', async () => {
  const record = { insurerId: 'insurer/id', generation: 3, suspendedAt: null, suspensionReason: null, latest: null };
  transport.get.mockResolvedValue(record);
  transport.put.mockResolvedValue(record);
  expect(await badgeGovernance.get('insurer/id')).toEqual(record);
  expect(transport.get).toHaveBeenCalledWith('/admin/insurer-reputation/insurer%2Fid/badge');
  const decision = { suspended: false, reason: 'Reviewed', expectedGeneration: 2 };
  expect(await badgeGovernance.update('insurer/id', decision)).toEqual(record);
  expect(transport.put).toHaveBeenCalledWith('/admin/insurer-reputation/insurer%2Fid/badge', decision);
});

it('reports that badge governance needs a connected API in mock mode', async () => {
  await expect(mockBadgeGovernance.get('one')).rejects.toThrow('connected API');
  await expect(mockBadgeGovernance.update('one', { suspended: true, reason: 'Review' })).rejects.toThrow('connected API');
  expect(transport.get).not.toHaveBeenCalled();
  expect(transport.put).not.toHaveBeenCalled();
});
