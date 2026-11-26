import { expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: transport }));
import { claims, inspections } from './index';
it('uses the later inspection wire routes and payloads without losing slot names', () => {
  claims.requestInspection('CL/1', 'SELF_CAPTURE');
  expect(transport.post).toHaveBeenLastCalledWith('/insurer/claims/CL%2F1/inspection', { method: 'SELF_CAPTURE' });
  const payload = { photos: [{ slot: 'engine_bay', documentId: 'doc-1' }] };
  inspections.submitEvidence('INS/1', payload);
  expect(transport.post).toHaveBeenLastCalledWith('/inspections/INS%2F1/evidence', payload);
  inspections.submitInsurerEvidence('INS/1', payload);
  expect(transport.post).toHaveBeenLastCalledWith('/insurer/inspections/INS%2F1/evidence', payload);
  inspections.attachReport('INS/1', 'report');
  expect(transport.post).toHaveBeenLastCalledWith('/insurer/inspections/INS%2F1/report', { documentId: 'report' });
  inspections.reinspect('INS/1');
  expect(transport.post).toHaveBeenLastCalledWith('/insurer/inspections/INS%2F1/reinspect');
  inspections.evidence('INS/1');
  expect(transport.get).toHaveBeenLastCalledWith('/insurer/inspections/INS%2F1/evidence');
});
