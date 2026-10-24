import { assertCatalogRegenerationAllowed } from './global-setup.js';

describe('assertCatalogRegenerationAllowed', () => {
  it('refuses regeneration when CI is set', () => {
    expect(() => assertCatalogRegenerationAllowed({ CI: 'true', REGENERATE_CATALOGS: '1' })).toThrow(
      'REGENERATE_CATALOGS=1 is not allowed when CI is set',
    );
  });

  it('allows regeneration outside CI', () => {
    expect(() => assertCatalogRegenerationAllowed({ REGENERATE_CATALOGS: '1' })).not.toThrow();
    expect(() => assertCatalogRegenerationAllowed({ CI: '', REGENERATE_CATALOGS: '1' })).not.toThrow();
  });

  it('allows a CI run that does not regenerate', () => {
    expect(() => assertCatalogRegenerationAllowed({ CI: 'true' })).not.toThrow();
    expect(() => assertCatalogRegenerationAllowed({ CI: 'true', REGENERATE_CATALOGS: '0' })).not.toThrow();
  });
});
