import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/database.module.js';
import { policies, quoteRequests, vehicles } from '../db/schema.js';
import { PLATE_WHITESPACE_SQL_PATTERN } from './domain/plate.js';

export interface KnownVehicle {
  vehicle: typeof vehicles.$inferSelect;
  observedAt: Date;
}

/** The prefix is matched literally, so a pattern character typed in a plate searches for itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

@Injectable()
export class VehiclesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The vehicles this customer has actually requested quotes for or insured.
   * Both database queries carry the customer predicate: platform data must
   * never be filtered only after it reaches the service.
   */
  async findKnownForCustomer(customerId: string, platePrefix: string): Promise<KnownVehicle[]> {
    const pattern = `%${escapeLike(platePrefix)}%`;
    const compactPlate = sql<string>`regexp_replace(${vehicles.plateNumber}, ${PLATE_WHITESPACE_SQL_PATTERN}, '', 'g')`;
    const [requested, insured] = await Promise.all([
      this.db
        .select({ vehicle: vehicles, observedAt: quoteRequests.submittedAt })
        .from(quoteRequests)
        .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
        .where(and(eq(quoteRequests.customerId, customerId), ilike(compactPlate, pattern)))
        .orderBy(desc(quoteRequests.submittedAt)),
      this.db
        .select({ vehicle: vehicles, observedAt: policies.receivedAt })
        .from(policies)
        .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
        .where(and(eq(policies.customerId, customerId), ilike(compactPlate, pattern)))
        .orderBy(desc(policies.receivedAt)),
    ]);
    return [...requested, ...insured];
  }
}
