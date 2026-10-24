import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/database.module.js';
import { vehicles } from '../db/schema.js';

@Injectable()
export class VehiclesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findLatest(limit: number) {
    return this.db
      .select({
        plateNumber: vehicles.plateNumber,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        color: vehicles.color,
        chassisNumber: vehicles.chassisNumber,
        engineNumber: vehicles.engineNumber,
        registrationDate: vehicles.registrationDate,
        rtsaAnniversaryDate: vehicles.rtsaAnniversaryDate,
      })
      .from(vehicles)
      .orderBy(desc(vehicles.updatedAt))
      .limit(limit);
  }
}
