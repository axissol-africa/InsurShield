import { hashPassword, temporaryPassword, verifyPassword } from './password.js';

describe('password storage', () => {
  it('verifies a password against its own hash', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash, so identical passwords do not share a hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('records the cost alongside the hash so it can be raised later', async () => {
    const stored = await hashPassword('whatever');
    const [scheme, n, r, p, salt, key] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('still verifies a hash written at a lower cost than today’s', async () => {
    // Hand-built at N=1024 — what an older deployment would have stored.
    const { scrypt } = await import('node:crypto');
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const key: Buffer = await new Promise((resolve, reject) =>
      scrypt('legacy-password', salt, 64, { N: 1024, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))),
    );
    const stored = `scrypt$1024$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
    expect(await verifyPassword('legacy-password', stored)).toBe(true);
  });

  it('refuses an empty hash, so a row with no password cannot be signed into', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('refuses a malformed hash instead of throwing', async () => {
    for (const bad of ['nonsense', 'scrypt$$$$', 'bcrypt$10$abc', 'scrypt$x$y$z$aa$bb']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('does not exhaust memory on absurd stored parameters', async () => {
    const stored = `scrypt$1073741824$8$1$${'ab'.repeat(16)}$${'cd'.repeat(32)}`;
    expect(await verifyPassword('anything', stored)).toBe(false);
  });

  it('generates temporary passwords that can be read out loud', () => {
    const issued = Array.from({ length: 50 }, () => temporaryPassword());
    for (const password of issued) {
      expect(password).toMatch(/^[a-z]{4}-[a-z]{4}-\d{2}$/);
      // i, l and o are left out of the letters because they are heard and read
      // as 1 and 0. The digits sit in their own group, so they stay unambiguous.
      const [first, second] = password.split('-');
      expect(first + second).not.toMatch(/[ilo]/);
    }
    expect(new Set(issued).size).toBe(issued.length);
  });
});
