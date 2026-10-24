import { seedOptionsFromEnv } from './seed-database.js';

const keycloak = {
  KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/insurshield',
  KEYCLOAK_CLIENT_SECRET: 'client-secret',
};

describe('seedOptionsFromEnv', () => {
  it('skips staff accounts and needs no staff password without a Keycloak client secret', () => {
    const options = seedOptionsFromEnv({ KEYCLOAK_ISSUER: keycloak.KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_SECRET: '' });

    expect(options.staff).toBeUndefined();
  });

  it('provisions staff with the password SEED_STAFF_PASSWORD gives', () => {
    const options = seedOptionsFromEnv({ ...keycloak, SEED_STAFF_PASSWORD: 'local-staff-password' });

    expect(options.staff?.password).toBe('local-staff-password');
  });

  it('refuses to provision staff without SEED_STAFF_PASSWORD', () => {
    expect(() => seedOptionsFromEnv(keycloak)).toThrow('SEED_STAFF_PASSWORD must be set');
  });

  it('refuses a staff password still holding the placeholder, without printing it', () => {
    const run = () => seedOptionsFromEnv({ ...keycloak, SEED_STAFF_PASSWORD: 'CHANGE_ME-secret' });

    expect(run).toThrow('SEED_STAFF_PASSWORD still contains the CHANGE_ME placeholder');
    expect(run).not.toThrow(/secret/);
  });

  it('refuses a Keycloak client secret still holding the placeholder, without printing it', () => {
    const run = () =>
      seedOptionsFromEnv({ ...keycloak, KEYCLOAK_CLIENT_SECRET: 'CHANGE_ME-secret', SEED_STAFF_PASSWORD: 'local' });

    expect(run).toThrow('KEYCLOAK_CLIENT_SECRET still contains the CHANGE_ME placeholder');
    expect(run).not.toThrow(/-secret/);
  });

  it('seeds demo data unless SEED_DEMO_DATA is false, and resets it only when SEED_RESET_DEMO is true', () => {
    expect(seedOptionsFromEnv({})).toMatchObject({ demoData: true, resetDemo: false });
    expect(seedOptionsFromEnv({ SEED_DEMO_DATA: 'false', SEED_RESET_DEMO: 'true' })).toMatchObject({
      demoData: false,
      resetDemo: true,
    });
  });
});
