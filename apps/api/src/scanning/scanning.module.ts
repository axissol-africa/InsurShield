import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { MALWARE_SCANNER } from './scanner.port.js';
import { StandInScanner } from './stand-in.scanner.js';

/**
 * Provides the scanner adapter and declares to the registry which one is
 * running.
 *
 * Only the stand-in exists today, so `MALWARE_SCANNER` accepts only that value
 * and the gate refuses a production start. A live adapter is added here beside
 * it: select it on the setting, provide it from the factory, and register it as
 * `live`.
 */
@Global()
@Module({
  providers: [{ provide: MALWARE_SCANNER, useClass: StandInScanner }],
  exports: [MALWARE_SCANNER],
})
export class ScanningModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry) {}

  onModuleInit(): void {
    this.registry.register({ name: 'malware-scanner', mode: 'stand-in', setting: 'MALWARE_SCANNER' });
  }
}
