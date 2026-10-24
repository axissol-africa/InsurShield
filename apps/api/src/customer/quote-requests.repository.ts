import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  customers,
  inspectionShots,
  insurerQuotes,
  insurers,
  ncdCodes,
  quoteRequestRecipients,
  quoteRequests,
  vehicles,
} from '../db/schema.js';
import { ncdCodeIssuedTo } from './ncd-code-ownership.js';

export type QuoteRequestRow = typeof quoteRequests.$inferSelect;
export type NewQuoteRequest = typeof quoteRequests.$inferInsert;
export type VehicleRow = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export interface RequestWithParties {
  request: QuoteRequestRow;
  customer: { fullName: string; email: string; phone: string };
  vehicle: VehicleRow;
}

export interface RecipientRow {
  quoteRequestId: string;
  insurerId: string;
  insurerName: string;
}

export interface QuoteRow {
  quoteRequestId: string;
  insurerName: string;
  premiumMinor: number;
  notes: string | null;
  insurerReference: string | null;
  validityDays: number;
  sentAt: Date;
  validUntil: Date;
  extendedAt: Date | null;
  documentId: string;
}

export interface RequoteLink {
  requotedFromId: string;
  id: string;
}

export interface UsableNcdCode {
  code: string;
  percentage: number;
  redeemedAt: Date | null;
  expiresAt: Date | null;
}

export interface NewShot {
  shotKey: string;
  documentId: string;
}

const PARTIES = {
  request: quoteRequests,
  customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
  vehicle: vehicles,
};

const VEHICLE_CANDIDATES = 50;

/** The prefix is matched literally, so a pattern character typed in a plate searches for itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

@Injectable()
export class QuoteRequestsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private on(tx?: Transaction): Database | Transaction {
    return tx ?? this.db;
  }

  listForCustomer(customerId: string): Promise<RequestWithParties[]> {
    return this.db
      .select(PARTIES)
      .from(quoteRequests)
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .where(eq(quoteRequests.customerId, customerId))
      .orderBy(desc(quoteRequests.submittedAt));
  }

  async findOwned(customerId: string, id: string, tx?: Transaction): Promise<RequestWithParties | undefined> {
    const [row] = await this.on(tx)
      .select(PARTIES)
      .from(quoteRequests)
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.customerId, customerId)));
    return row;
  }

  recipientsOf(quoteRequestIds: string[], tx?: Transaction): Promise<RecipientRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        quoteRequestId: quoteRequestRecipients.quoteRequestId,
        insurerId: quoteRequestRecipients.insurerId,
        insurerName: insurers.name,
      })
      .from(quoteRequestRecipients)
      .innerJoin(insurers, eq(insurers.id, quoteRequestRecipients.insurerId))
      .where(inArray(quoteRequestRecipients.quoteRequestId, quoteRequestIds))
      .orderBy(asc(insurers.name));
  }

  quotesOf(quoteRequestIds: string[], tx?: Transaction): Promise<QuoteRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        quoteRequestId: insurerQuotes.quoteRequestId,
        insurerName: insurers.name,
        premiumMinor: insurerQuotes.premiumMinor,
        notes: insurerQuotes.notes,
        insurerReference: insurerQuotes.insurerReference,
        validityDays: insurerQuotes.validityDays,
        sentAt: insurerQuotes.sentAt,
        validUntil: insurerQuotes.validUntil,
        extendedAt: insurerQuotes.extendedAt,
        documentId: insurerQuotes.documentId,
      })
      .from(insurerQuotes)
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      .where(inArray(insurerQuotes.quoteRequestId, quoteRequestIds))
      .orderBy(asc(insurers.name));
  }

  /** The requests that were sent again, and the new request each became. */
  requoteLinksOf(quoteRequestIds: string[], tx?: Transaction): Promise<RequoteLink[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({ requotedFromId: quoteRequests.requotedFromId, id: quoteRequests.id })
      .from(quoteRequests)
      .where(inArray(quoteRequests.requotedFromId, quoteRequestIds))
      .then((links) => links.filter((link): link is RequoteLink => link.requotedFromId !== null));
  }

  /** The customer's own request, locked until `tx` ends so it is sent again at most once. */
  async lockOwned(tx: Transaction, customerId: string, id: string): Promise<QuoteRequestRow | undefined> {
    const [request] = await tx
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.customerId, customerId)))
      .for('update');
    return request;
  }

  /** Held shared until `tx` ends, so a deactivation in flight is waited for and none commits under the request. */
  async activeInsurerIds(tx: Transaction): Promise<string[]> {
    const rows = await tx
      .select({ id: insurers.id })
      .from(insurers)
      .where(eq(insurers.status, 'ACTIVE'))
      .orderBy(asc(insurers.name))
      .for('share');
    return rows.map((insurer) => insurer.id);
  }

  vehicleCandidates(tx: Transaction, platePrefix: string): Promise<VehicleRow[]> {
    return tx
      .select()
      .from(vehicles)
      .where(ilike(vehicles.plateNumber, `%${escapeLike(platePrefix)}%`))
      .limit(VEHICLE_CANDIDATES);
  }

  async insertVehicle(tx: Transaction, vehicle: NewVehicle): Promise<VehicleRow> {
    const [created] = await tx.insert(vehicles).values(vehicle).returning();
    return created;
  }

  async updateVehicle(tx: Transaction, id: string, vehicle: NewVehicle): Promise<VehicleRow> {
    const [updated] = await tx.update(vehicles).set(vehicle).where(eq(vehicles.id, id)).returning();
    return updated;
  }

  /** The code only when it was issued on this customer's own application. */
  async findNcdCodeIssuedTo(tx: Transaction, code: string, customerId: string): Promise<UsableNcdCode | undefined> {
    const [found] = await tx
      .select({
        code: ncdCodes.code,
        percentage: ncdCodes.percentage,
        redeemedAt: ncdCodes.redeemedAt,
        expiresAt: ncdCodes.expiresAt,
      })
      .from(ncdCodes)
      .where(and(eq(ncdCodes.code, code), ncdCodeIssuedTo(customerId)));
    return found;
  }

  async insertRequest(tx: Transaction, request: NewQuoteRequest): Promise<QuoteRequestRow> {
    const [created] = await tx.insert(quoteRequests).values(request).returning();
    return created;
  }

  async insertRecipients(tx: Transaction, quoteRequestId: string, insurerIds: string[]): Promise<void> {
    if (insurerIds.length === 0) return;
    await tx
      .insert(quoteRequestRecipients)
      .values(insurerIds.map((insurerId) => ({ quoteRequestId, insurerId, status: 'PENDING' as const })));
  }

  async insertShots(tx: Transaction, quoteRequestId: string, shots: NewShot[]): Promise<void> {
    if (shots.length === 0) return;
    await tx.insert(inspectionShots).values(shots.map((shot) => ({ quoteRequestId, ...shot })));
  }
}
