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
  it('sees object storage live and every simulated system declared', async () => {
    const production = await startApp({ env: LIVE_AUTH });
    try {
      const registry = production.app.get(ProviderRegistry);

      expect(registry.list()).toEqual([
        { name: 'malware-scanner', mode: 'stand-in', setting: 'MALWARE_SCANNER' },
        { name: 'object-storage', mode: 'live', setting: 'S3_ENDPOINT' },
        { name: 'payment-provider', mode: 'stand-in' },
        { name: 'rtsa-vehicle-lookup', mode: 'stand-in' },
      ]);
    } finally {
      await production.close();
    }
  });

  it('refuses to start while the scanner is simulated, naming it and its setting', async () => {
    const production = await startApp({ env: LIVE_AUTH });
    try {
      const registry = production.app.get(ProviderRegistry);

      expect(() => registry.assertNoStandInsInProduction('production')).toThrow(
        'Refusing to start in production on simulated providers: malware-scanner (MALWARE_SCANNER), ' +
          'payment-provider (no live adapter yet), rtsa-vehicle-lookup (no live adapter yet). ' +
          'Configure a live adapter for each, or deploy a non-production environment.',
      );
    } finally {
      await production.close();
    }
  });
});
