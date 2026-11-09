import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry) {}

  /** Object storage is always a real bucket: MinIO locally, S3 in production. */
  onModuleInit(): void {
    this.registry.register({ name: 'object-storage', mode: 'live', setting: 'S3_ENDPOINT' });
  }
}
