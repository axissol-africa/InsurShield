import type { Request } from 'express';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export function httpMethod(request: Request): string { return METHODS.has(request.method) ? request.method : 'OTHER'; }

/** Only Express's registered template is eligible. Never use path, originalUrl, params or a resolved mount path. */
export function httpRoute(request: Request): string {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null || !('path' in route)) return '__unmatched__';
  const path: unknown = route.path;
  return typeof path === 'string' && path.length <= 160 && /^\/[A-Za-z0-9/_:*{}().-]*$/.test(path)
    ? path : '__other_route__';
}
