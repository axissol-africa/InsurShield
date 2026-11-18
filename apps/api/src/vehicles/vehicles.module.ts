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

  /** RTSA is deliberately manual until its approved adapter and credentials arrive. */
  onModuleInit(): void {
    this.registry.register({ name: 'rtsa-vehicle-lookup', mode: 'manual' });
  }
}
