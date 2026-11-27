const relativeOrigin = 'https://relative-api.invalid';
const loopback = /^(?:localhost\.?|127\..*|\[::1\])$/i;

export function assertReleaseApi(env) {
  if (env.VITE_API_MODE !== 'http') {
    throw new Error('Release builds require VITE_API_MODE=http.');
  }
  const base = env.VITE_API_BASE_URL;
  if (typeof base === 'string' && base && !/[\s\\?#\p{Cc}\p{Cf}]/u.test(base)) {
    const relative = base.startsWith('/') && !base.startsWith('//');
    const url = relative || base.startsWith('https://') ? URL.parse(base, relativeOrigin) : null;
    if (url && !url.username && !url.password &&
        (relative ? url.origin === relativeOrigin && /[^/]/u.test(url.pathname) : url.protocol === 'https:' && !loopback.test(url.hostname))) {
      return;
    }
  }
  throw new Error('VITE_API_BASE_URL must be a same-origin API subpath or a deployed HTTPS API URL without credentials, query or fragment.');
}
