import { getTableConfig } from 'drizzle-orm/pg-core';
import { ncdApplications, ncdCodes, ncdEvidence } from './schema.js';

describe('NCD historical bindings', () => {
  it('keeps legacy application and rule bindings nullable with no invented defaults', () => {
    for (const column of [ncdApplications.sourcePolicyNumber, ncdApplications.sourceVehicleId,
      ncdApplications.declarationAcceptedAt, ncdApplications.declarationVersion,
      ncdApplications.decisionNote, ncdCodes.revokedAt, ncdCodes.issuedRuleVersion]) {
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    }
    expect(ncdApplications.verificationRevision.default).toBe(0);
    expect(ncdApplications.verificationRevision.notNull).toBe(true);
    expect(ncdCodes.issuedRuleVersion.getSQLType()).toBe('integer');
  });

  it('preserves evidence references and makes each document single use', () => {
    const config = getTableConfig(ncdEvidence);
    expect(config.foreignKeys.map((key) => key.onDelete)).toEqual(['restrict', 'restrict']);
    const unique = config.indexes.find(({ config }) => config.unique)?.config;
    expect(unique?.columns.map((column) => 'name' in column ? column.name : null)).toEqual(['documentId']);
    const lookup = config.indexes.find(({ config }) => !config.unique)?.config;
    expect(lookup?.columns.map((column) => 'name' in column ? column.name : null))
      .toEqual(['applicationId', 'verificationRevision', 'createdAt', 'documentId']);
  });
});
