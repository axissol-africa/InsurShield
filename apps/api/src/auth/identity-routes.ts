import { getSessionCookie } from 'better-auth/cookies';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { IDENTITY_HEADER, identityHeader, identityMatches } from '../common/auth/identity-precondition.js';
import { IDENTITY_CHANGED, IDENTITY_CHANGED_MESSAGE } from '../common/auth/messages.js';
import { errorBody } from '../common/errors/api.exception.js';
import { answerFailure } from '../common/filters/api-exception.filter.js';
import type { Env } from '../config/env.js';
import { CLIENT_ADDRESS_HEADER, COOKIE_PREFIX, identityBasePath, mailRoutesEnabled } from './auth.constants.js';
import type { Database } from '../db/database.module.js';
import type { Auth, AuthSettings } from './auth.instance.js';
import { resolveIdentity, type Identity } from './identity.js';

const ALWAYS = [
  'POST /register',
  'POST /sign-in/email',
  'POST /sign-out',
  'POST /revoke-sessions',
  'POST /change-password',
];
const MAIL = [
  'POST /request-password-reset',
  'POST /reset-password',
  'POST /send-verification-email',
  'GET /verify-email',
];
/** Several times the largest body the identity routes take, a registration. */
export const IDENTITY_BODY_LIMIT_BYTES = 8 * 1024;

/** These replace the session, and the tab binds to whoever their response names. */
const UNCHECKED = new Set(['POST /register', 'POST /sign-in/email']);
/** A refused account is refused a session at sign-in, and may always end one. */
const OPEN_TO_REFUSED = new Set([...UNCHECKED, 'POST /sign-out']);

/** Every identity route the API serves, as `METHOD /path` under the base path. Everything else is 404. */
export function identityRoutes(nodeEnv: Env['NODE_ENV']): string[] {
  return mailRoutesEnabled(nodeEnv) ? [...ALWAYS, ...MAIL] : [...ALWAYS];
}

function send(response: Response, status: number, code: string, message: string) {
  response.status(status).json(errorBody(code, message));
}

/** The raw path, compared exactly: Express's own matching ignores case and trailing slashes. */
function routeOf(request: Request, basePath: string): string | undefined {
  const path = request.originalUrl.split('?')[0];
  return path.startsWith(`${basePath}/`) ? `${request.method} ${path.slice(basePath.length)}` : undefined;
}

function allowList(basePath: string, routes: Set<string>): RequestHandler {
  return (request, response, next) => {
    const route = routeOf(request, basePath);
    if (route !== undefined && routes.has(route)) return next();
    send(response, 404, 'NOT_FOUND', 'Not found.');
  };
}

/** Better Auth reads a body whole, whatever its size, so a long or unmeasured one is refused unread. */
function bodyLimit(request: Request, response: Response, next: NextFunction) {
  const length = request.headers['content-length'];
  const unmeasured = request.headers['transfer-encoding'] !== undefined;
  if (unmeasured || (length !== undefined && Number(length) > IDENTITY_BODY_LIMIT_BYTES)) {
    response.setHeader('Connection', 'close');
    return send(response, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  next();
}

/** Better Auth trusts any forwarding header it is told to read, so it is given only the address Express derived. */
export function clientAddress(request: Request, _response: Response, next: NextFunction) {
  delete request.headers[CLIENT_ADDRESS_HEADER];
  if (request.ip) request.headers[CLIENT_ADDRESS_HEADER] = request.ip;
  next();
}

/**
 * Better Auth routes by a URL it builds from `X-Forwarded-Proto` and `Host`, so both are replaced with the
 * configured origin and the path is the one the allow-list checked.
 */
function configuredUrl(baseUrl: string): RequestHandler {
  const { protocol, host } = new URL(baseUrl);
  return (request, _response, next) => {
    request.headers['x-forwarded-proto'] = protocol.slice(0, -1);
    request.headers.host = host;
    delete request.headers[':authority'];
    request.url = request.originalUrl;
    next();
  };
}

/**
 * The identity precondition, and the account rule the guard applies to Nest routes: a refused account may still
 * sign out, but changes nothing else. Without a session Better Auth answers for itself.
 */
function sessionChecks(auth: Auth, db: Database, basePath: string): RequestHandler {
  return async (request, response, next) => {
    const route = routeOf(request, basePath);
    if (route === undefined) return next();
    const expected = identityHeader(request.headers[IDENTITY_HEADER]);
    const checkHeader = expected !== undefined && !UNCHECKED.has(route);
    const checkAccount = !OPEN_TO_REFUSED.has(route);
    if (!checkHeader && !checkAccount) return next();
    const headers = fromNodeHeaders(request.headers);
    let sessionUserId: string | null = null;
    let identity: Identity | undefined;
    if (getSessionCookie(headers, { cookiePrefix: COOKIE_PREFIX }) !== null) {
      try {
        const session = await auth.api.getSession({ headers, query: { disableRefresh: true } });
        sessionUserId = session?.user.id ?? null;
        if (checkAccount && sessionUserId !== null) identity = await resolveIdentity(db, sessionUserId);
      } catch (error) {
        return answerFailure(error, request, response);
      }
    }
    if (checkHeader && !identityMatches(expected, sessionUserId)) {
      return send(response, 409, IDENTITY_CHANGED, IDENTITY_CHANGED_MESSAGE);
    }
    if (identity && !identity.ok) return send(response, identity.status, identity.code, identity.message);
    next();
  };
}

function answeringFailures(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response) => handler(request, response).catch((error: unknown) => answerFailure(error, request, response));
}

/**
 * Mounts Better Auth under `/<API_PREFIX>/identity`. It must be installed before Nest initialises, which is
 * when Nest adds its JSON parser, so Better Auth reads the raw body; and after CORS, so its answers carry it.
 */
export function mountIdentity(
  express: Express,
  auth: Auth,
  db: Database,
  settings: Pick<AuthSettings, 'API_PREFIX' | 'NODE_ENV' | 'BETTER_AUTH_URL'>,
) {
  const basePath = identityBasePath(settings.API_PREFIX);
  const pattern = `${basePath}/*splat`;
  express.all(
    pattern,
    allowList(basePath, new Set(identityRoutes(settings.NODE_ENV))),
    bodyLimit,
    clientAddress,
    sessionChecks(auth, db, basePath),
    configuredUrl(settings.BETTER_AUTH_URL),
    answeringFailures(toNodeHandler(auth)),
  );
}
