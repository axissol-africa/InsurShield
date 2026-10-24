import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { comparablePlate, displayPlate } from './domain/plate.js';
import { VehiclesRepository } from './vehicles.repository.js';

/** Only this many of the most recently updated vehicles are searched for a known plate. */
const KNOWN_VEHICLE_CANDIDATES = 50;

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
 * A plate the platform has already insured is answered from our own records;
 * anything else falls back to the RTSA stand-in. When the real registry is
 * connected only `lookupFromRegistry` changes — callers and the response shape
 * stay as they are.
 */
@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private readonly repository: VehiclesRepository) {}

  async lookup(plate: string) {
    const trimmed = plate?.trim() ?? '';
    if (trimmed.length < 3) {
      throw new ApiException('INVALID_PLATE', 'Enter the vehicle’s licence plate number.');
    }

    const known = await this.findKnownVehicle(trimmed);
    if (known) {
      this.logger.log(`Plate ${displayPlate(trimmed)} matched a vehicle already on the platform`);
      return known;
    }

    return this.lookupFromRegistry(trimmed);
  }

  /**
   * A vehicle we have quoted or insured before. Reusing it keeps one plate to
   * one record, so a returning customer sees the details they confirmed last
   * time rather than a fresh guess.
   */
  private async findKnownVehicle(plate: string) {
    const compact = comparablePlate(plate);
    const candidates = await this.repository.findLatest(KNOWN_VEHICLE_CANDIDATES);
    const match = candidates.find((vehicle) => comparablePlate(vehicle.plateNumber) === compact);
    if (!match) return null;

    return {
      plateNumber: match.plateNumber,
      make: match.make,
      model: match.model,
      year: match.year,
      color: match.color,
      chassisNumber: match.chassisNumber,
      engineNumber: match.engineNumber,
      registrationDate: match.registrationDate?.toISOString() ?? null,
      rtsaAnniversaryDate: match.rtsaAnniversaryDate?.toISOString() ?? null,
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
