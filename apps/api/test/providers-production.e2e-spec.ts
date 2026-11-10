import './production-process.js';
import { ProviderRegistry } from '../src/common/providers/provider-registry.js';
import { startApp } from './helpers.js';

const LIVE_AUTH = { AUTH_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: '1' };

/**
 * The gate itself runs in `main.ts`, before the port opens, so an e2e app never
 * reaches it. What these checks prove is the input it acts on: with the modules
 * wired as a deployment wires them, the registry reports the real modes, and
 * the rule refuses this configuration in production.
 */
describe('the provider gate with the application wired for production', () => {
  it('declares every simulated system, the development bucket among them', async () => {
    const production = await startApp({ env: LIVE_AUTH });
    try {
      const registry = production.app.get(ProviderRegistry);

      // These checks run against the development MinIO, so object storage is
      // simulated here and the registry says so. A deployment that leaves
      // S3_ENDPOINT unset, or points it at a hosted bucket, registers it live.
      expect(registry.list()).toEqual([
        { name: 'email', mode: 'stand-in', setting: 'MAIL_SENDER' },
        { name: 'malware-scanner', mode: 'stand-in', setting: 'MALWARE_SCANNER' },
        { name: 'object-storage', mode: 'stand-in', setting: 'S3_ENDPOINT' },
        { name: 'payment-provider', mode: 'stand-in' },
        { name: 'rtsa-vehicle-lookup', mode: 'stand-in' },
      ]);
    } finally {
      await production.close();
    }
  });

  it('refuses to start on this configuration, naming each simulated system and its setting', async () => {
    const production = await startApp({ env: LIVE_AUTH });
    try {
      const registry = production.app.get(ProviderRegistry);

      expect(() => registry.assertNoStandInsInProduction('production')).toThrow(
        'Refusing to start in production on simulated providers: email (MAIL_SENDER), ' +
          'malware-scanner (MALWARE_SCANNER), object-storage (S3_ENDPOINT), ' +
          'payment-provider (no live adapter yet), rtsa-vehicle-lookup (no live adapter yet). ' +
          'Configure a live adapter for each, or deploy a non-production environment.',
      );
    } finally {
      await production.close();
    }
  });
});
