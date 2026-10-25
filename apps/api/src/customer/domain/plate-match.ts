import { comparablePlate } from '../../vehicles/domain/plate.js';

/** The letters a candidate search is narrowed by before plates are compared exactly. */
export const plateSearchPrefix = (plate: string): string => comparablePlate(plate).slice(0, 3);

/** The vehicle already on file for this plate, however either side spaced or cased it. */
export function findVehicleByPlate<T extends { plateNumber: string }>(candidates: T[], plate: string): T | undefined {
  const wanted = comparablePlate(plate);
  return candidates.find((vehicle) => comparablePlate(vehicle.plateNumber) === wanted);
}
