import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { comparablePlate, displayPlate } from './domain/plate.js';
import { VehiclesRepository } from './vehicles.repository.js';

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
   * RTSA credentials and the approved data contract are not available yet.
   * Returning a plausible car would let false data become an insurance record,
   * so the safe adapter requires the already-supported manual entry path.
   */
  private lookupFromRegistry(plate: string) {
    // Validate display formatting without logging or storing a failed lookup.
    void displayPlate(plate);
    throw new ApiException(
      'RTSA_LOOKUP_UNAVAILABLE',
      'Vehicle lookup is not connected yet. Enter the vehicle details manually to continue.',
      503,
      { manualEntry: true },
    );
  }
}
