import 'reflect-metadata';
import { amendmentFailure, evidenceReference } from './risk-review.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignRiskDto, ListRiskQuery, ReferRiskDto, ResolveRiskDto } from '../dto/risk-review.dto.js';
const id = '10000000-0000-4000-8000-000000000001';
it('uses authoritative typed evidence references', () => {
  expect(evidenceReference('QUOTE', id)).toBe(`quote:${id}`);
  expect(evidenceReference('RECONCILIATION_ITEM', id)).toBe(`reconciliation:${id}`);
});
it('rejects stale and terminal edits, but permits current open and assigned reviews', () => {
  expect(amendmentFailure('OPEN', 2, 1)).toBe('RISK_REVIEW_STALE');
  expect(amendmentFailure('RESOLVED', 2, 2)).toBe('RISK_REVIEW_RESOLVED');
  expect(amendmentFailure('OPEN', 1, 1)).toBeNull();
  expect(amendmentFailure('IN_PROGRESS', 2, 2)).toBeNull();
});
it('rejects whitespace explanations, arbitrary workflow kinds and oversized pages', async () => {
  const dto = plainToInstance(ReferRiskDto, { workflowType: 'CUSTOMER', workflowId: id, evidenceReference: `quote:${id}`, severity: 'HIGH', reason: '               ', nextAction: '   ' });
  expect((await validate(dto)).map((error) => error.property)).toEqual(expect.arrayContaining(['workflowType', 'reason', 'nextAction']));
  expect(await validate(plainToInstance(ListRiskQuery, { limit: 101 }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(ListRiskQuery, { cursor: 'not-a-uuid' }))).not.toHaveLength(0);
});
it('requires a version and an explicit assignment; rejects adverse outcomes', async () => {
  expect(await validate(plainToInstance(AssignRiskDto, { expectedVersion: 1, staffId: null, nextAction: 'Review evidence' }))).toHaveLength(0);
  expect(await validate(plainToInstance(AssignRiskDto, { staffId: id, nextAction: 'Review evidence' }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(AssignRiskDto, { expectedVersion: 1, nextAction: 'Review evidence' }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(ResolveRiskDto, { expectedVersion: 1, outcome: 'DECLINE_CUSTOMER', reason: 'Unsupported adverse effect', nextAction: 'Close record' }))).not.toHaveLength(0);
});
