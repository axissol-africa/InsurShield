import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/database.module.js';
import { consentRecords, customers, insurers, staffUsers } from '../db/schema.js';

export interface NewCustomer {
  keycloakId: string;
  email: string;
  fullName: string;
  phone: string;
}

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

  async findStaffByKeycloakId(keycloakId: string) {
    const [staff] = await this.db
      .select({
        id: staffUsers.id,
        email: staffUsers.email,
        insurerId: staffUsers.insurerId,
        isActive: staffUsers.isActive,
      })
      .from(staffUsers)
      .where(eq(staffUsers.keycloakId, keycloakId));
    return staff;
  }

  async findCustomerByKeycloakId(keycloakId: string) {
    const [customer] = await this.db
      .select({ id: customers.id, email: customers.email, deletedAt: customers.deletedAt })
      .from(customers)
      .where(eq(customers.keycloakId, keycloakId));
    return customer;
  }

  /** No conflict target, so every unique index arbitrates and a clash on any of them inserts nothing. */
  async insertCustomerIfAbsent(customer: NewCustomer): Promise<void> {
    await this.db.insert(customers).values(customer).onConflictDoNothing();
  }

  async findStaffSession(staffId: string) {
    const [staff] = await this.db
      .select({
        id: staffUsers.id,
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
}
