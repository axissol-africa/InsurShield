import { Global, Module } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry.js';

/**
 * Global so any adapter can register itself without the module graph having to
 * route the registry through each feature module.
 */
@Global()
@Module({
  providers: [ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
