import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { CallbackSignatureService } from './callback-signature.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsRepository } from './integrations.repository.js';
import { IntegrationSecretsService } from './integration-secrets.service.js';
import { IntegrationsService } from './integrations.service.js';

/**
 * Global because any business module may atomically queue an integration
 * delivery with its own state change. Controllers still remain explicitly
 * permissioned; exporting the service does not expose an HTTP operation.
 */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsRepository,
    IntegrationSecretsService,
    CallbackSignatureService,
    IntegrationsService,
  ],
  exports: [IntegrationsService, IntegrationSecretsService],
})
export class IntegrationsModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry) {}

  /** The insurer portal remains the approved manual route until an API is enabled. */
  onModuleInit(): void {
    this.registry.register({ name: 'insurer-api-delivery', mode: 'manual' });
  }
}
