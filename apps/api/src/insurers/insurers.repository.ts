import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerContacts, insurers } from '../db/schema.js';
import type { InsurerStatus } from '../common/domain/enums.js';

export type NewInsurer = Omit<typeof insurers.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'>;
export type InsurerChanges = Partial<NewInsurer>;
export type NewContact = Omit<typeof insurerContacts.$inferInsert, 'insurerId'>;

// What an unauthenticated visitor may see; the credentials in insurer_integrations are never selected.
const publicColumns = {
  id: insurers.id,
  name: insurers.name,
  tradingName: insurers.tradingName,
  status: insurers.status,
  rateBps: insurers.rateBps,
  quoteValidityDays: insurers.quoteValidityDays,
  coverage: insurers.coverage,
  plan: insurers.plan,
  website: insurers.website,
  logoUrl: insurers.logoUrl,
  ncdAccepted: insurers.ncdAccepted,
  inspectionRule: insurers.inspectionRule,
  inspectionTiming: insurers.inspectionTiming,
  inspectionMethod: insurers.inspectionMethod,
  icon: insurers.icon,
  isBestValue: insurers.isBestValue,
  benefits: insurers.benefits,
};

const staffColumns = {
  ...publicColumns,
  licenceNumber: insurers.licenceNumber,
  licenceExpiry: insurers.licenceExpiry,
  registrationNumber: insurers.registrationNumber,
  tpin: insurers.tpin,
};

const contactColumns = {
  tagline: insurerContacts.tagline,
  contactPerson: insurerContacts.contactPerson,
  role: insurerContacts.role,
  phone: insurerContacts.phone,
  mobile: insurerContacts.mobile,
  whatsapp: insurerContacts.whatsapp,
  email: insurerContacts.email,
  address: insurerContacts.address,
  hours: insurerContacts.hours,
};

type Executor = Database | Transaction;

export type PublicInsurerRow = Awaited<ReturnType<InsurersRepository['listPublic']>>[number];
export type InsurerRow = NonNullable<Awaited<ReturnType<InsurersRepository['find']>>>;
export type ContactRow = NonNullable<InsurerRow['contact']>;

@Injectable()
export class InsurersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async listPublic(status: InsurerStatus) {
    return this.db
      .select({ ...publicColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(eq(insurers.status, status))
      .orderBy(asc(insurers.name));
  }

  async listNotDeleted() {
    return this.db
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(ne(insurers.status, 'DELETED'))
      .orderBy(asc(insurers.name));
  }

  async find(id: string, executor: Executor = this.db) {
    const [row] = await executor
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(eq(insurers.id, id));
    return row;
  }

  async insert(tx: Transaction, insurer: NewInsurer, contact: NewContact): Promise<InsurerRow> {
    const [row] = await tx.insert(insurers).values(insurer).returning(staffColumns);
    const [stored] = await tx
      .insert(insurerContacts)
      .values({ ...contact, insurerId: row.id })
      .returning(contactColumns);
    return { ...row, contact: stored };
  }

  /** Changes an insurer that is not deleted; undefined when there is none. */
  async update(tx: Transaction, id: string, changes: InsurerChanges & { status?: InsurerStatus; deletedAt?: Date | null }) {
    const [row] = await tx
      .update(insurers)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(insurers.id, id), ne(insurers.status, 'DELETED')))
      .returning(staffColumns);
    return row;
  }

  /** Writes the fields given; on an existing contact, fields left undefined keep their value. */
  async upsertContact(tx: Transaction, insurerId: string, contact: NewContact): Promise<ContactRow> {
    const [row] = await tx
      .insert(insurerContacts)
      .values({ ...contact, insurerId })
      .onConflictDoUpdate({ target: insurerContacts.insurerId, set: contact })
      .returning(contactColumns);
    return row;
  }

  async findContact(tx: Transaction, insurerId: string): Promise<ContactRow | null> {
    const [row] = await tx.select(contactColumns).from(insurerContacts).where(eq(insurerContacts.insurerId, insurerId));
    return row ?? null;
  }
}
