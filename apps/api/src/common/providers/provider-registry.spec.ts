import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';

const live = { name: 'object-storage', mode: 'live' as const, setting: 'S3_ENDPOINT' };
const standIn = { name: 'malware-scanner', mode: 'stand-in' as const, setting: 'MALWARE_SCANNER' };

describe('ProviderRegistry', () => {
  it('lists each registered provider once, by name', () => {
    const registry = new ProviderRegistry();
    registry.register(standIn);
    registry.register(live);
    registry.register({ ...standIn, mode: 'live' });

    expect(registry.list()).toEqual([{ ...standIn, mode: 'live' }, live]);
    expect(registry.standIns()).toEqual([]);
  });

  it('refuses a production start while any provider is a stand-in, naming it and its setting', () => {
    const registry = new ProviderRegistry();
    registry.register(live);
    registry.register(standIn);

    expect(() => registry.assertNoStandInsInProduction('production')).toThrow(
      /malware-scanner \(MALWARE_SCANNER\)/,
    );
  });

  it('lets production start once every provider is live', () => {
    const registry = new ProviderRegistry();
    registry.register(live);
    registry.register({ ...standIn, mode: 'live' });

    expect(() => registry.assertNoStandInsInProduction('production')).not.toThrow();
  });

  it.each(['development', 'test'])('allows a stand-in in %s', (nodeEnv) => {
    const registry = new ProviderRegistry();
    registry.register(standIn);

    expect(() => registry.assertNoStandInsInProduction(nodeEnv)).not.toThrow();
  });

  it('reports the modes outside production only', () => {
    const registry = new ProviderRegistry();
    registry.register(standIn);
    const logger = { log: vi.fn() };

    registry.report('production', logger as never);
    expect(logger.log).not.toHaveBeenCalled();

    registry.report('development', logger as never);
    expect(logger.log).toHaveBeenCalledWith('malware-scanner: stand-in (MALWARE_SCANNER)');
  });
});
