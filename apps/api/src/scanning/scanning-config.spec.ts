import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { ProvidersModule } from '../common/providers/providers.module.js';
import { validateEnv } from '../config/env.js';
import { isPrivateScannerAddress } from './clamd-address.js';
import { ClamdScanner } from './clamd.scanner.js';
import { MALWARE_SCANNER, type MalwareScanner } from './scanner.port.js';
import { ScanningModule } from './scanning.module.js';
import { StandInScanner } from './stand-in.scanner.js';

const base = {
  NODE_ENV: 'test', PORT: '4000', CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture_test', DATABASE_POOL_SIZE: '10', S3_BUCKET: 'fixture',
  BETTER_AUTH_SECRET: 'synthetic-secret-with-at-least-32-characters', BETTER_AUTH_URL: 'http://localhost:4000',
  TRUST_PROXY_HOPS: '0', RTSA_ANNIVERSARY_FEE_NGWEE: '50000',
};
const live = { MALWARE_SCANNER: 'clamd', CLAMD_ADDRESS: '127.0.0.1', CLAMD_PORT: '3310' };

describe('scanner configuration', () => {
  it('defaults to the existing stand-in without a scanner address or port', () => {
    const env = validateEnv(base);
    expect(env.MALWARE_SCANNER).toBe('stand-in');
    expect(env.CLAMD_ADDRESS).toBeUndefined();
    expect(env.CLAMD_PORT).toBeUndefined();
    expect(env.CLAMD_TIMEOUT_MS).toBe(10000);
    expect(env.CLAMD_MAX_RESPONSE_BYTES).toBe(4096);
  });

  it('requires explicitly configured address and port when selecting clamd', () => {
    expect(() => validateEnv({ ...base, MALWARE_SCANNER: 'clamd' })).toThrow('CLAMD_ADDRESS');
    expect(() => validateEnv({ ...base, MALWARE_SCANNER: 'clamd', CLAMD_ADDRESS: live.CLAMD_ADDRESS })).toThrow('CLAMD_PORT');
    expect(validateEnv({ ...base, ...live }).CLAMD_PORT).toBe(3310);
  });

  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.0.1', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', '::ffff:192.168.0.1'])('accepts private/loopback literal %s', (address) => {
    expect(isPrivateScannerAddress(address)).toBe(true);
    expect(validateEnv({ ...base, ...live, CLAMD_ADDRESS: address }).CLAMD_ADDRESS).toBe(address);
  });

  it.each(['8.8.8.8', '172.15.255.255', '172.32.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::', '2001:4860:4860::8888', '::ffff:8.8.8.8', 'fe80::1', 'ff02::1', 'localhost', 'clamd.internal', '127.1', '2130706433', '127.0.0.1%lo0', '::1%lo0', '[::1]', ' 127.0.0.1', '127.0.0.1\n'])('rejects public, ambiguous, or DNS address %j without exposing it', (address) => {
    expect(isPrivateScannerAddress(address)).toBe(false);
    try {
      validateEnv({ ...base, ...live, CLAMD_ADDRESS: address });
      expect.unreachable('Expected private address validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('CLAMD_ADDRESS');
      expect(String(error)).not.toContain(address);
    }
  });

  it.each([
    ['CLAMD_PORT', '0'], ['CLAMD_PORT', '65536'], ['CLAMD_PORT', '1.5'], ['CLAMD_PORT', '3310junk'],
    ['CLAMD_TIMEOUT_MS', '0'], ['CLAMD_TIMEOUT_MS', '99'], ['CLAMD_TIMEOUT_MS', '60001'],
    ['CLAMD_MAX_RESPONSE_BYTES', '0'], ['CLAMD_MAX_RESPONSE_BYTES', '255'], ['CLAMD_MAX_RESPONSE_BYTES', '16385'],
  ])('refuses invalid %s limits', (key, value) => {
    expect(() => validateEnv({ ...base, ...live, [key]: value })).toThrow(key);
  });

  it('rejects direct construction with unsafe configuration before any network activity', () => {
    const settings = { address: '127.0.0.1', port: 3310, timeoutMs: 100, maxResponseBytes: 256, maxInputBytes: 1024 };
    expect(() => new ClamdScanner({ ...settings, address: 'public.example.invalid' })).toThrow('CLAMD_ADDRESS');
    expect(() => new ClamdScanner({ ...settings, port: 0 })).toThrow('CLAMD_PORT');
    expect(() => new ClamdScanner({ ...settings, timeoutMs: Number.NaN })).toThrow('CLAMD_TIMEOUT_MS');
    expect(() => new ClamdScanner({ ...settings, maxResponseBytes: Infinity })).toThrow('CLAMD_MAX_RESPONSE_BYTES');
    expect(() => new ClamdScanner({ ...settings, maxInputBytes: 0 })).toThrow('MAX_UPLOAD_BYTES');
  });
});

describe('scanner selection and production registration', () => {
  it.each(['stand-in', 'clamd'] as const)('provides and registers only the selected %s adapter without opening a connection', async (selection) => {
    const env = validateEnv({ ...base, ...(selection === 'clamd' ? live : {}) });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule, ScanningModule],
    }).overrideProvider(ConfigService).useValue(new ConfigService(env)).compile();
    try {
      await module.init();
      const scanner = module.get<MalwareScanner>(MALWARE_SCANNER);
      expect(scanner).toBeInstanceOf(selection === 'clamd' ? ClamdScanner : StandInScanner);
      expect(scanner.name).toBe(selection);
      const registry = module.get(ProviderRegistry);
      expect(registry.list()).toEqual([{ name: 'malware-scanner', mode: selection === 'clamd' ? 'live' : 'stand-in', setting: 'MALWARE_SCANNER' }]);
      if (selection === 'clamd') expect(() => registry.assertNoStandInsInProduction('production')).not.toThrow();
      else expect(() => registry.assertNoStandInsInProduction('production')).toThrow('MALWARE_SCANNER');
    } finally {
      await module.close();
    }
  });
});
