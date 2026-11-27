import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import type { Env } from '../config/env.js';
import { ClamdScanner } from './clamd.scanner.js';
import { MALWARE_SCANNER, type MalwareScanner } from './scanner.port.js';
import { StandInScanner } from './stand-in.scanner.js';

@Global()
@Module({
  providers: [{
    provide: MALWARE_SCANNER,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): MalwareScanner =>
      config.get('MALWARE_SCANNER', { infer: true }) === 'clamd'
        ? new ClamdScanner({
            address: config.getOrThrow('CLAMD_ADDRESS', { infer: true }),
            port: config.getOrThrow('CLAMD_PORT', { infer: true }),
            timeoutMs: config.get('CLAMD_TIMEOUT_MS', { infer: true }),
            maxResponseBytes: config.get('CLAMD_MAX_RESPONSE_BYTES', { infer: true }),
            maxInputBytes: config.get('MAX_UPLOAD_BYTES', { infer: true }),
          })
        : new StandInScanner(),
  }],
  exports: [MALWARE_SCANNER],
})
export class ScanningModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry, private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'malware-scanner',
      mode: this.config.get('MALWARE_SCANNER', { infer: true }) === 'clamd' ? 'live' : 'stand-in',
      setting: 'MALWARE_SCANNER',
    });
  }
}
