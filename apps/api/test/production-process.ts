// Better Auth reads NODE_ENV once, when it is first loaded, and treats TEST (which Vitest sets) as a test run,
// so a spec imports this before anything else. Production refuses the e2e default AUTH_RATE_LIMIT=off.
process.env.NODE_ENV = 'production';
delete process.env.TEST;
process.env.AUTH_RATE_LIMIT = 'on';
