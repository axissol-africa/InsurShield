import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../common/audit/audit.service.js';
import { RULE_SETTING_KEYS, type RuleSettingKey } from '../common/domain/enums.js';
import type { Env } from '../config/env.js';
import { defaultRuleValue } from './domain/rules.js';
import type { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

const at = new Date('2026-11-26T22:00:00.000Z');
const lusakaMidnight = new Date('2026-11-27T00:00:00.000Z');
const approved = (key: RuleSettingKey) => ({ value: defaultRuleValue(key), versionNumber: 3 });

function fixture(environment: Env['NODE_ENV'] = 'production') {
  const repository = { effectiveRule: vi.fn(async (key: RuleSettingKey, _day: Date, _state: string): Promise<{ value: unknown; versionNumber: number } | undefined> => approved(key)) };
  const service = new SettingsService(
    repository as unknown as SettingsRepository,
    {} as AuditService,
    new ConfigService<Env, true>({ NODE_ENV: environment }),
  );
  return { service, repository };
}

describe('production rule approvals', () => {
  it('checks every rule against the same Lusaka day and accepts the confirmed values', async () => {
    const { service, repository } = fixture();
    await expect(service.assertProductionRules(at)).resolves.toBeUndefined();
    expect(repository.effectiveRule.mock.calls).toEqual(
      RULE_SETTING_KEYS.map((key) => [key, lusakaMidnight, 'CONFIRMED']),
    );
    await expect(service.effective('NCD_POLICY', at)).resolves.toEqual({
      value: defaultRuleValue('NCD_POLICY'), version: 3, provisional: false,
    });
  });

  it('refuses startup with absent or invalid approvals and reveals rule names only', async () => {
    const { service, repository } = fixture();
    repository.effectiveRule.mockImplementation(async (key) => {
      if (key === 'NCD_POLICY') return undefined;
      if (key === 'ACCOUNT_RETENTION') return { value: 'private-test-value', versionNumber: 3 };
      return approved(key);
    });
    await expect(service.assertProductionRules(at)).rejects.toThrow(
      'Production requires active, valid approval for platform rules: NCD_POLICY, ACCOUNT_RETENTION.',
    );
  });

  it('reports the approval check failure without echoing a database error', async () => {
    const { service, repository } = fixture();
    repository.effectiveRule.mockRejectedValue(new Error('postgresql://private-test-user'));
    await expect(service.assertProductionRules(at)).rejects.toThrow(/^Production rule approvals could not be verified\.$/);
  });

  it('rejects a production lookup with no active approval rather than applying a default', async () => {
    const { service, repository } = fixture();
    repository.effectiveRule.mockResolvedValueOnce(undefined);
    await expect(service.effective('PAYMENT_CHARGES', at)).rejects.toMatchObject({
      code: 'RULE_NOT_APPROVED',
      status: 503,
    });
    expect(repository.effectiveRule.mock.calls.map(([, , state]) => state)).toEqual(['CONFIRMED']);
  });

  it.each(['development', 'test'] as const)('keeps %s fixtures and provisional values usable', async (environment) => {
    const { service, repository } = fixture(environment);
    await service.assertProductionRules(at);
    expect(repository.effectiveRule).not.toHaveBeenCalled();
    repository.effectiveRule.mockResolvedValueOnce(undefined).mockResolvedValueOnce(approved('PAYMENT_CHARGES'));
    await expect(service.effective('PAYMENT_CHARGES', at)).resolves.toMatchObject({ provisional: true, version: 3 });
  });
});
