import { ConfigService } from '@nestjs/config';
import { eq, max } from 'drizzle-orm';
import { AuditService } from '../src/common/audit/audit.service.js';
import { RULE_SETTING_KEYS } from '../src/common/domain/enums.js';
import type { Env } from '../src/config/env.js';
import { platformRuleVersions } from '../src/db/schema.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { SettingsRepository } from '../src/settings/settings.repository.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { buildStaffUser } from './builders.js';
import { startApp } from './helpers.js';

it('requires confirmed rules for the Lusaka release date and refuses an expired rule at runtime', async () => {
  const app = await startApp();
  let ownerId: string | undefined;
  try {
    const owner = await buildStaffUser(app.db);
    ownerId = owner.id;
    const approver = await buildStaffUser(app.db);
    const service = new SettingsService(
      app.app.get(SettingsRepository),
      app.app.get(AuditService),
      new ConfigService<Env, true>({ NODE_ENV: 'production' }),
    );
    const existing = await app.db.select({ key: platformRuleVersions.key, version: max(platformRuleVersions.versionNumber) })
      .from(platformRuleVersions).groupBy(platformRuleVersions.key);
    const latest = new Map(existing.map(({ key, version }) => [key, version ?? 0]));
    const effective = new Date('1999-01-02T00:00:00Z');
    const start = new Date('1999-01-01T22:00:00Z');
    const end = new Date('1999-01-02T22:00:00Z');

    const rules = RULE_SETTING_KEYS.map((key) => ({
      key, versionNumber: (latest.get(key) ?? 0) + 1, state: 'CONFIRMED' as const,
      value: defaultRuleValue(key), effectiveFrom: effective, effectiveUntil: effective,
      createdByStaffId: owner.id, confirmedByStaffId: approver.id, confirmedAt: start,
    }));
    await app.db.insert(platformRuleVersions).values(rules.filter(({ key }) => key !== 'REPUTATION_POLICY'));
    const reputation = rules.find(({ key }) => key === 'REPUTATION_POLICY')!;
    await app.db.insert(platformRuleVersions).values({
      ...reputation, state: 'PROVISIONAL', confirmedByStaffId: null, confirmedAt: null,
    });
    await expect(service.assertProductionRules(start)).rejects.toThrow(/platform rules: REPUTATION_POLICY\./);

    await app.db.insert(platformRuleVersions).values({ ...reputation, versionNumber: reputation.versionNumber + 1 });
    await expect(service.assertProductionRules(start)).resolves.toBeUndefined();
    await expect(service.effective('REPUTATION_POLICY', start)).resolves.toMatchObject({
      provisional: false, version: reputation.versionNumber + 1,
    });
    await expect(service.effective('REPUTATION_POLICY', end)).rejects.toMatchObject({ code: 'RULE_NOT_APPROVED', status: 503 });
  } finally {
    try {
      if (ownerId) await app.db.delete(platformRuleVersions).where(eq(platformRuleVersions.createdByStaffId, ownerId));
    } finally {
      await app.close();
    }
  }
});
