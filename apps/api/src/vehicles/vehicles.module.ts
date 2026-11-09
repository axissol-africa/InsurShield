import { Module, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesRepository } from './vehicles.repository.js';
import { VehiclesService } from './vehicles.service.js';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesRepository],
  exports: [VehiclesService],
})
export class VehiclesModule implements OnModuleInit {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Plate lookup answers from a canned vehicle until the registry integration
   * lands, so it registers as what it is. The integration batch replaces this
   * with the live adapter and the mode with it.
   */
  onModuleInit(): void {
    this.registry.register({ name: 'rtsa-vehicle-lookup', mode: 'stand-in' });
  }
}
