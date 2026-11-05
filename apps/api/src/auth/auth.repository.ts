import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { authSessions, consentRecords, customers, insurers, staffUsers } from '../db/schema.js';

export interface NewConsent {
  customerId: string;
  privacyVersion: string;
  termsVersion: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findStaffSession(staffId: string) {
    const [staff] = await this.db
      .select({
        id: staffUsers.id,
        userId: staffUsers.userId,
        fullName: staffUsers.fullName,
        email: staffUsers.email,
        insurerId: staffUsers.insurerId,
        insurerName: insurers.name,
      })
      .from(staffUsers)
      .leftJoin(insurers, eq(insurers.id, staffUsers.insurerId))
      .where(eq(staffUsers.id, staffId));
    return staff;
  }

  async findCustomerProfile(customerId: string) {
    const [customer] = await this.db
      .select({
        id: customers.id,
        userId: customers.userId,
        fullName: customers.fullName,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(eq(customers.id, customerId));
    return customer;
  }

  async findLatestConsent(customerId: string) {
    const [consent] = await this.db
      .select({ privacyVersion: consentRecords.privacyVersion, acceptedAt: consentRecords.acceptedAt })
      .from(consentRecords)
      .where(eq(consentRecords.customerId, customerId))
      .orderBy(desc(consentRecords.acceptedAt))
      .limit(1);
    return consent;
  }

  async insertConsent(consent: NewConsent) {
    const [record] = await this.db
      .insert(consentRecords)
      .values(consent)
      .returning({
        privacyVersion: consentRecords.privacyVersion,
        acceptedAt: consentRecords.acceptedAt,
      });
    return record;
  }

  async deleteSessions(tx: Transaction, userId: string): Promise<void> {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
  }
}
