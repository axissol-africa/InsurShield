import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { comparablePlate, displayPlate } from './domain/plate.js';
import { VehiclesRepository } from './vehicles.repository.js';

/**
 * The reference vehicle the RTSA stand-in returns for any plate it has never
 * seen. It exists so the journey can be walked end to end before the registry
 * integration lands; every field is overwritten the moment RTSA is connected.
 */
const STAND_IN = {
  make: 'Toyota',
  model: 'Hilux',
  year: '2020',
  color: 'White',
  chassisNumber: 'JTEH1234560012345',
  engineNumber: '2GD-FTV-12345',
  registrationDate: '2020-03-15',
  rtsaAnniversaryDate: '2023-10-31',
};

/**
 * Vehicle identification.
 *
 * A customer can recover the most recent vehicle they have previously
 * submitted or insured. Everyone else receives the registry response; platform
 * records are never a public vehicle registry.
 */
@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private readonly repository: VehiclesRepository) {}

  async lookup(plate: string, principal?: Principal) {
    const trimmed = plate?.trim() ?? '';
    if (trimmed.length < 3) {
      throw new ApiException('INVALID_PLATE', 'Enter the vehicle’s licence plate number.');
    }

    const known = principal?.kind === 'customer' ? await this.findKnownVehicle(trimmed, principal.id) : null;
    if (known) {
      this.logger.log(`Plate ${displayPlate(trimmed)} matched the customer’s own platform vehicle`);
      return known;
    }

    return this.lookupFromRegistry(trimmed);
  }

  /**
   * The customer’s latest matching request or policy. We compare compacted
   * plates after the server-side customer filter so older spacing is harmless.
   */
  private async findKnownVehicle(plate: string, customerId: string) {
    const compact = comparablePlate(plate);
    const candidates = await this.repository.findKnownForCustomer(customerId, compact.slice(0, 3));
    const match = candidates
      .filter(({ vehicle }) => comparablePlate(vehicle.plateNumber) === compact)
      .reduce<(typeof candidates)[number] | undefined>(
        (latest, candidate) => (!latest || candidate.observedAt > latest.observedAt ? candidate : latest),
        undefined,
      );
    if (!match) return null;

    const { vehicle } = match;

    return {
      plateNumber: vehicle.plateNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      chassisNumber: vehicle.chassisNumber,
      engineNumber: vehicle.engineNumber,
      registrationDate: vehicle.registrationDate?.toISOString() ?? null,
      rtsaAnniversaryDate: vehicle.rtsaAnniversaryDate?.toISOString() ?? null,
      source: 'PLATFORM' as const,
    };
  }

  /**
   * Stand-in for the RTSA vehicle registry (DEC-007: authenticated lookup with
   * manual entry as the fallback). `source: 'RTSA_STAND_IN'` is deliberately on
   * the response so a caller can tell real registry data from placeholder data.
   */
  private lookupFromRegistry(plate: string) {
    return {
      plateNumber: displayPlate(plate),
      ...STAND_IN,
      source: 'RTSA_STAND_IN' as const,
    };
  }
}
