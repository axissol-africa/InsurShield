import { seedOptionsFromEnv } from './seed-database.js';

describe('seedOptionsFromEnv', () => {
  it('requires the shared seeded-account password', () => {
    expect(() => seedOptionsFromEnv({})).toThrow(
      'SEED_STAFF_PASSWORD must be set',
    );
  });

  it('uses SEED_STAFF_PASSWORD for every seeded account and resets only when asked', () => {
    const options = seedOptionsFromEnv({
      SEED_STAFF_PASSWORD: 'local-staff-password',
      SEED_RESET_PASSWORDS: 'true',
    });

    expect(options).toMatchObject({
      password: 'local-staff-password',
      resetPasswords: true,
    });
  });

  it('refuses a shared password still holding the placeholder, without printing it', () => {
    const run = () =>
      seedOptionsFromEnv({ SEED_STAFF_PASSWORD: 'CHANGE_ME-secret' });

    expect(run).toThrow(
      'SEED_STAFF_PASSWORD still contains the CHANGE_ME placeholder',
    );
    expect(run).not.toThrow(/secret/);
  });

  it('seeds demo data unless SEED_DEMO_DATA is false, and resets it only when SEED_RESET_DEMO is true', () => {
    expect(
      seedOptionsFromEnv({ SEED_STAFF_PASSWORD: 'local-password' }),
    ).toMatchObject({
      demoData: true,
      resetDemo: false,
    });
    expect(
      seedOptionsFromEnv({
        SEED_STAFF_PASSWORD: 'local-password',
        SEED_DEMO_DATA: 'false',
        SEED_RESET_DEMO: 'true',
      }),
    ).toMatchObject({
      demoData: false,
      resetDemo: true,
    });
  });
});
