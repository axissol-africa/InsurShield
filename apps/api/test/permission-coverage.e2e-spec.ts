import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_OPTIONAL_AUTH, IS_PUBLIC, REQUIRED_PERMISSION } from '../src/common/auth/auth.guard.js';
import { PERMISSIONS, type Permission } from '../src/common/auth/permissions.js';
import { startApp, type TestApp } from './helpers.js';

/**
 * The guard refuses a route that names no permission, which protects nothing
 * unless every route really carries one. This reads the controllers the
 * application built and holds three properties:
 *
 *   - every route either names a permission or is explicitly open,
 *   - exactly the intended routes are open,
 *   - every permission in the table is reached by some route.
 *
 * The last one matters as much as the first: a permission no route needs is a
 * grant nothing enforces, and a table of those stops describing the system.
 */

/**
 * Reached with no session at all, and so with no permission: two health probes,
 * the directory, approved product catalogue and PIA floor a visitor compares,
 * and the code a customer
 * checks before signing up.
 */
const PUBLIC_ROUTES = 6;
/**
 * Served to guests too, but a signed-in caller is still held to a permission,
 * because the guard returns early only when there is no session.
 */
const OPTIONAL_AUTH_ROUTES = 1;
/** Guards against a walk that silently finds nothing; the route count only grows. */
const LEAST_ROUTES = 48;

interface Route {
  name: string;
  permission: Permission | undefined;
  public: boolean;
  optional: boolean;
}

describe('every route says who may reach it', () => {
  let testApp: TestApp;
  let routes: Route[];

  beforeAll(async () => {
    testApp = await startApp();
    const reflector = testApp.app.get(Reflector);
    const modules = testApp.app.get(ModulesContainer);

    type Handler = (...args: never[]) => unknown;
    type Controller = new (...args: never[]) => object;
    const path = (target: Controller | Handler) => reflector.get<string | undefined, string>(PATH_METADATA, target);
    const flag = (key: string, targets: (Controller | Handler)[]) =>
      reflector.getAllAndOverride<boolean | undefined, string>(key, targets) ?? false;

    routes = [...modules.values()]
      .flatMap((module) => [...module.controllers.values()])
      .map((wrapper) => wrapper.metatype)
      .filter((controller): controller is Controller => typeof controller === 'function')
      .flatMap((controller) => {
        const base = path(controller) ?? '';
        const members = controller.prototype as Record<string, unknown>;
        return Object.getOwnPropertyNames(controller.prototype)
          .filter((member) => member !== 'constructor')
          .flatMap((member) => {
            const handler = members[member];
            if (typeof handler !== 'function') return [];
            const route = path(handler as Handler);
            if (route === undefined) return [];
            const targets: (Controller | Handler)[] = [handler as Handler, controller];
            return [
              {
                name: `${controller.name}.${member} (${base || '/'}${route})`,
                permission: reflector.getAllAndOverride<Permission | undefined, string>(
                  REQUIRED_PERMISSION,
                  targets,
                ),
                public: flag(IS_PUBLIC, targets),
                optional: flag(IS_OPTIONAL_AUTH, targets),
              },
            ];
          });
      });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('read the whole router rather than part of it', () => {
    expect(routes.length).toBeGreaterThanOrEqual(LEAST_ROUTES);
  });

  it('names a permission on every route that needs a session', () => {
    const silent = routes.filter((route) => !route.public && !route.permission).map((route) => route.name);

    expect(silent, 'the guard refuses these, so a silent route is a bug rather than a policy').toEqual([]);
  });

  it('serves without a session only the routes meant to be public', () => {
    expect(routes.filter((route) => route.public)).toHaveLength(PUBLIC_ROUTES);
    expect(routes.filter((route) => route.optional)).toHaveLength(OPTIONAL_AUTH_ROUTES);
  });

  it('reaches every permission the table grants', () => {
    const reached = new Set(routes.flatMap((route) => (route.permission ? [route.permission] : [])));
    const unreached = Object.keys(PERMISSIONS).filter((permission) => !reached.has(permission as Permission));

    expect(unreached, 'a permission no route needs is a grant nothing enforces').toEqual([]);
  });

  it('never names a permission on a public route, which would never be read', () => {
    const misleading = routes.filter((route) => route.public && route.permission).map((route) => route.name);

    expect(misleading, 'the guard returns before the permission check for these').toEqual([]);
  });
});
