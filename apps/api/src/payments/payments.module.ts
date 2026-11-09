import { Module, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * A payment is confirmed in this API rather than by a provider, so it is a
   * stand-in too. The payments batch brings the real gateway and its callbacks.
   */
  onModuleInit(): void {
    this.registry.register({ name: 'payment-provider', mode: 'stand-in' });
  }
}
