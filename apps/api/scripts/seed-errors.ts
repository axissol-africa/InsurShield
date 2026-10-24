import { causes, describeDatabaseError } from '../src/db/errors.js';
import { failureReason } from '../src/db/migrator.js';
import { KeycloakAdminError } from './keycloak-admin.js';

/** The seed's own failure, whose message is printed as it is, so it never holds a value it was given. */
export class SeedError extends Error {
  override name = 'SeedError';
}

/** A setting the seed needs is missing or wrong. Its message names the setting and the rule, never the value. */
export class SeedConfigurationError extends SeedError {
  override name = 'SeedConfigurationError';
}

/** A record the seed wrote or expected is not there. */
export class SeedDataError extends SeedError {
  override name = 'SeedDataError';
}

export interface SeedFailure {
  message: string;
  details: { code?: string; constraint?: string };
}

const UNEXPECTED = 'an unexpected error';
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

// Driver, query and library messages can carry hosts, statements, parameters and response bodies.
export function describeSeedFailure(error: unknown): SeedFailure {
  if (error instanceof SeedError) {
    return { message: `db:seed failed: ${error.message}`, details: {} };
  }
  if (error instanceof KeycloakAdminError) {
    return { message: `db:seed failed: ${error.message}`, details: error.code ? { code: error.code } : {} };
  }
  return { message: `db:seed failed: ${unexpectedReason(error)}`, details: describeDatabaseError(error) };
}

function unexpectedReason(error: unknown): string {
  for (const current of causes(error)) {
    const reason = failureReason(current);
    if (!reason.startsWith(UNEXPECTED)) return reason;
  }
  const name = error instanceof Error ? (ERROR_NAME.test(error.name) ? error.name : 'Error') : typeof error;
  return `${UNEXPECTED} (${name})`;
}
