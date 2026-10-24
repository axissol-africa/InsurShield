import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { demoVehicleId } from './demo-data.js';
import { seedDatabaseUrl, seedOptionsFromEnv } from './seed-database.js';
import { describeSeedFailure } from './seed-errors.js';

const SECRET = 'sentinel-7f3a';

function printed(error: unknown) {
  const { message, details } = describeSeedFailure(error);
  return `${message} ${JSON.stringify(details)}`;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('describeSeedFailure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prints the seed configuration message', () => {
    const error = caught(() =>
      seedOptionsFromEnv({ KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/insurshield', KEYCLOAK_CLIENT_SECRET: 'x' }),
    );

    expect(describeSeedFailure(error).message).toBe(
      'db:seed failed: SEED_STAFF_PASSWORD must be set to provision staff accounts',
    );
  });

  it('prints the message of a demo record the seed expected but did not find', () => {
    const error = caught(() => demoVehicleId(new Map(), 'demo-hilux'));

    expect(describeSeedFailure(error).message).toBe('db:seed failed: The demo vehicle demo-hilux is missing');
  });

  it('prints which database setting is wrong, without its value', () => {
    vi.stubEnv('DATABASE_URL', `postgresql://user:${SECRET}-CHANGE_ME@localhost:5432/insurshield`);

    const line = printed(caught(() => seedDatabaseUrl()));

    expect(line).toContain('DATABASE_URL still contains the CHANGE_ME placeholder');
    expect(line).not.toContain(SECRET);
  });

  it('prints neither the statement nor its parameters when a query cannot reach the database', () => {
    const refused = Object.assign(new Error(`connect ECONNREFUSED 10.0.0.5:5432 ${SECRET}`), { code: 'ECONNREFUSED' });
    const error = new DrizzleQueryError('insert into "staff_users" ("email") values ($1)', [SECRET], refused);

    const line = printed(error);

    expect(line).toContain('ECONNREFUSED');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('staff_users');
    expect(line).not.toContain('10.0.0.5');
  });

  it('prints the SQLSTATE and constraint of a failed statement, never its detail or values', () => {
    const server = Object.assign(new DatabaseError(`duplicate key ${SECRET}`, 0, 'error'), {
      code: '23505',
      constraint: 'staff_users_email_key',
      detail: `Key (email)=(${SECRET}) already exists.`,
    });
    const error = new DrizzleQueryError('insert into "staff_users" ("email") values ($1)', [SECRET], server);

    const line = printed(error);

    expect(line).toContain('23505');
    expect(line).toContain('staff_users_email_key');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('insert into');
  });

  it('prints only the name and code of an error the seed did not raise itself', () => {
    const error = Object.assign(new TypeError(`cannot read ${SECRET}`), { code: 'ERR_INVALID_ARG_TYPE' });

    const line = printed(error);

    expect(line).toContain('TypeError');
    expect(line).toContain('ERR_INVALID_ARG_TYPE');
    expect(line).not.toContain(SECRET);
  });
});
