import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurers, ncdApplications, ncdCodes } from '../db/schema.js';

export type NcdApplicationRow = typeof ncdApplications.$inferSelect;
export type NewNcdApplication = typeof ncdApplications.$inferInsert;

export interface NcdApplicationWithInsurer {
  application: NcdApplicationRow;
  insurerName: string;
}

export interface NcdCodeWithInsurer {
  code: string;
  percentage: number;
  yearsClaimFree: number;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  insurerId: string;
  insurerName: string;
}

@Injectable()
export class NcdRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  listForCustomer(customerId: string): Promise<NcdApplicationWithInsurer[]> {
    return this.db
      .select({ application: ncdApplications, insurerName: insurers.name })
      .from(ncdApplications)
      .innerJoin(insurers, eq(insurers.id, ncdApplications.insurerId))
      .where(eq(ncdApplications.customerId, customerId))
      .orderBy(desc(ncdApplications.submittedAt));
  }

  /** Held shared until `tx` ends, so the insurer stays active while the application is written. */
  async findActiveInsurer(tx: Transaction, insurerId: string): Promise<{ id: string; name: string } | undefined> {
    const [insurer] = await tx
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(and(eq(insurers.id, insurerId), eq(insurers.status, 'ACTIVE')))
      .for('share');
    return insurer;
  }

  async insertApplication(tx: Transaction, application: NewNcdApplication): Promise<NcdApplicationRow> {
    const [created] = await tx.insert(ncdApplications).values(application).returning();
    return created;
  }

  async findCode(code: string): Promise<NcdCodeWithInsurer | undefined> {
    const [found] = await this.db
      .select({
        code: ncdCodes.code,
        percentage: ncdCodes.percentage,
        yearsClaimFree: ncdCodes.yearsClaimFree,
        expiresAt: ncdCodes.expiresAt,
        redeemedAt: ncdCodes.redeemedAt,
        insurerId: insurers.id,
        insurerName: insurers.name,
      })
      .from(ncdCodes)
      .innerJoin(insurers, eq(insurers.id, ncdCodes.insurerId))
      .where(eq(ncdCodes.code, code));
    return found;
  }
}
