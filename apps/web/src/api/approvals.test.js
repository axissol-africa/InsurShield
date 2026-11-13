import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import { admin, auth, config, insurers } from './mock';
import { admin as httpAdmin } from './http';
import { apiClient } from '@/lib/apiClient';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', mockLatencyMs: 0 } }));
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const session = (id, staffRole = 'SUPER_ADMIN') => useStore.setState({ staffSession: { id, name: id, role: 'admin', staffRole } });
const current = () => useStore.getState().insurersList[0];
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useStore.setState({
    insurersList: [{ id: 'insurer-1', name: 'Test Assurance', status: 'Active', evidence: [{ kind: 'LICENCE', state: 'APPROVED', expiresAt: '2099-01-01' }] }],
    quoteRequests: [{ id: 'quote-1', insurers: ['Test Assurance'], insurerQuotes: { 'Test Assurance': { premium: 100 } } }],
    piaConfig: { piaRatePercentage: 4 },
  });
  session('maker');
});

describe('approval HTTP contract', () => {
  it('lists and sends decision objects to encoded approval paths', async () => {
    await httpAdmin.approvals.list();
    await httpAdmin.approvals.approve('id/1', { reason: 'Checked' });
    await httpAdmin.approvals.reject('id/2');
    expect(apiClient.get).toHaveBeenCalledWith('/admin/approvals');
    expect(apiClient.post).toHaveBeenCalledWith('/admin/approvals/id%2F1/approve', { reason: 'Checked' });
    expect(apiClient.post).toHaveBeenCalledWith('/admin/approvals/id%2F2/reject', {});
  });
});

describe('mock maker/checker', () => {
  it('freezes PIA changes and applies them once after independent approval', async () => {
    const input = { piaRatePercentage: 6, secret: 'never-copy' };
    const proposal = await config.setPia(input);
    input.piaRatePercentage = 10;
    expect(await config.getPia()).toEqual({ piaRatePercentage: 4 });
    expect(proposal).toMatchObject({ status: 'PENDING', proposal: { piaRatePercentage: 6 } });
    expect(JSON.stringify(proposal)).not.toContain('never-copy');
    expect(proposal).not.toHaveProperty('payload');
    await expect(admin.approvals.approve(proposal.id)).rejects.toThrow('different');
    await expect(admin.approvals.reject(proposal.id)).rejects.toThrow('different');
    await expect(config.setPia({ piaRatePercentage: 7 })).rejects.toThrow('already waiting');
    session('checker', 'ADMIN');
    expect(await admin.approvals.approve(proposal.id, { reason: ' Verified ' })).toMatchObject({ status: 'EXECUTED', decisionReason: 'Verified', decidedByStaffId: 'checker' });
    expect(await config.getPia()).toEqual({ piaRatePercentage: 6 });
    await expect(admin.approvals.approve(proposal.id)).rejects.toThrow('no longer pending');
    expect(await admin.approvals.list()).toEqual([
      expect.objectContaining({ id: proposal.id, status: 'EXECUTED', proposal: { piaRatePercentage: 6 } }),
    ]);
  });

  it.each([
    ['deactivate', () => insurers.setStatus('insurer-1', 'Inactive'), 'Inactive'],
    ['suspend', () => insurers.suspend('insurer-1', 'Licence issue'), 'Suspended'],
    ['delete', () => insurers.remove('insurer-1'), 'Deleted'],
    ['restore', () => { useStore.getState().updateInsurer('insurer-1', { status: 'Deleted' }); return insurers.restore('insurer-1'); }, 'Inactive'],
    ['activate', () => { useStore.getState().updateInsurer('insurer-1', { status: 'Pending' }); return insurers.activate('insurer-1', { effectiveFrom: '2026-11-12', clientSecret: 'secret' }); }, 'Active'],
  ])('stages %s without changing insurer or quotes until approval', async (_action, propose, expected) => {
    const request = await propose();
    const before = current().status;
    expect(before).not.toBe(expected);
    expect(useStore.getState().quoteRequests[0].insurerQuotes['Test Assurance']).not.toHaveProperty('unavailableAt');
    expect(JSON.stringify(request)).not.toContain('clientSecret');
    session('checker');
    await admin.approvals.approve(request.id);
    expect(current().status).toBe(expected);
    if (expected === 'Suspended') expect(useStore.getState().quoteRequests[0].insurerQuotes['Test Assurance'].unavailableAt).toBeTruthy();
  });

  it('rejects without applying and permits a new proposal', async () => {
    const request = await insurers.suspend('insurer-1', 'Review required');
    session('checker');
    expect(await admin.approvals.reject(request.id, { reason: 'Not warranted' })).toMatchObject({ status: 'REJECTED', executedAt: null });
    expect(current().status).toBe('Active');
    expect((await insurers.suspend('insurer-1', 'New review')).id).not.toBe(request.id);
  });

  it('revalidates activation evidence at decision time and preserves pending request after failure', async () => {
    useStore.getState().updateInsurer('insurer-1', { status: 'Pending' });
    const request = await insurers.activate('insurer-1', { effectiveFrom: '2026-11-12' });
    useStore.getState().updateInsurer('insurer-1', { evidence: [{ kind: 'LICENCE', state: 'REJECTED' }] });
    session('checker');
    await expect(admin.approvals.approve(request.id)).rejects.toThrow('no approved licence');
    expect(current().status).toBe('Pending');
    expect(await admin.approvals.list()).toHaveLength(1);
  });

  it('enforces expiry, role permissions, missing identity, and super-admin deletion', async () => {
    const request = await insurers.remove('insurer-1');
    session('checker', 'ADMIN');
    await expect(admin.approvals.approve(request.id)).rejects.toThrow('authorised');
    session('checker', 'INSURER_ADMIN');
    await expect(admin.approvals.list()).rejects.toThrow('authorised');
    session(undefined);
    await expect(admin.approvals.list()).rejects.toThrow('Sign in again');
    session('checker');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(request.expiresAt) + 1);
    await expect(admin.approvals.approve(request.id)).rejects.toThrow('expired');
    expect(await admin.approvals.list()).toEqual([
      expect.objectContaining({ id: request.id, status: 'EXPIRED' }),
    ]);
    expect(current().status).toBe('Active');
    now.mockRestore();
  });

  it('assigns stable, distinct identities to mock administrators', async () => {
    const maker = await auth.signIn('admin@maker.example', 'demo');
    const request = await config.setPia({ piaRatePercentage: 5 });
    const checker = await auth.signIn('admin@checker.example', 'demo');
    expect(maker.staffSession.id).not.toBe(checker.staffSession.id);
    expect((await admin.approvals.approve(request.id)).status).toBe('EXECUTED');
  });

  it('binds the existing demo login to the same maker across sign-ins', async () => {
    useStore.setState({ staffSession: { role: 'admin', staffRole: 'SUPER_ADMIN', name: 'Admin' } });
    const request = await config.setPia({ piaRatePercentage: 5 });
    expect(useStore.getState().staffSession.id).toBe('mock:admin@insurshield.zm');
    await auth.signIn('admin@insurshield.zm', 'demo');
    await expect(admin.approvals.approve(request.id)).rejects.toThrow('different');
    expect(await config.getPia()).toEqual({ piaRatePercentage: 4 });
  });

  it('accepts only one of two simultaneous decisions', async () => {
    const request = await config.setPia({ piaRatePercentage: 5 });
    session('checker');
    const results = await Promise.allSettled([admin.approvals.approve(request.id), admin.approvals.reject(request.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
