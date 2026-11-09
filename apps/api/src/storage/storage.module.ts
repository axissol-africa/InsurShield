import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import type { Env } from '../config/env.js';
import { isLocalEndpoint } from './endpoint.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Derived, not asserted: a deploy that inherits the development bucket is
   * refused rather than attested as live. A hosted S3-compatible endpoint is
   * still live, so only the configuration that reaches production by accident
   * trips the gate.
   */
  onModuleInit(): void {
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    this.registry.register({
      name: 'object-storage',
      mode: endpoint && isLocalEndpoint(endpoint) ? 'stand-in' : 'live',
      setting: 'S3_ENDPOINT',
    });
  }
}
