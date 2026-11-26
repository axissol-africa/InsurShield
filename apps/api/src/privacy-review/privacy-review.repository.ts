import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DATABASE,
  type Database,
  type Transaction,
} from '../db/database.module.js';
import {
  customers,
  privacyRequests,
  privacyRequestEvents,
  staffUsers,
} from '../db/schema.js';
import type { PrivacyListDto } from './dto/privacy-review.dto.js';
export type PrivacyRequestRow = typeof privacyRequests.$inferSelect;
@Injectable()
export class PrivacyReviewRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(work);
  }
  async customer(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .for('share');
    return row;
  }
  async fence(tx: Transaction, customerId: string) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 16))`,
    );
    const result = await tx.execute<{ started: boolean }>(sql`SELECT EXISTS (
      SELECT 1 FROM documents d WHERE d."deletionStartedAt" IS NOT NULL
      AND ${customerId}::uuid IN (SELECT public.retention_document_owners(d.id))
    ) AS started`);
    return result.rows[0]?.started !== false;
  }
  async owner(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.id, id))
      .for('share');
    return row;
  }
  async create(tx: Transaction, values: typeof privacyRequests.$inferInsert) {
    const [row] = await tx.insert(privacyRequests).values(values).returning();
    return row;
  }
  async get(id: string, tx?: Transaction, lock = false) {
    const query = (tx ?? this.db)
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }
  async list(query: PrivacyListDto, customerId?: string) {
    return this.db
      .select()
      .from(privacyRequests)
      .where(
        and(
          customerId ? eq(privacyRequests.customerId, customerId) : undefined,
          query.status ? eq(privacyRequests.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(privacyRequests.createdAt), desc(privacyRequests.id))
      .limit(25)
      .offset(((query.page ?? 1) - 1) * 25);
  }
  async events(id: string, page: number) {
    return this.db
      .select()
      .from(privacyRequestEvents)
      .where(eq(privacyRequestEvents.requestId, id))
      .orderBy(desc(privacyRequestEvents.version))
      .limit(25)
      .offset((page - 1) * 25);
  }
  async update(
    tx: Transaction,
    row: PrivacyRequestRow,
    values: Partial<typeof privacyRequests.$inferInsert>,
  ) {
    const [updated] = await tx
      .update(privacyRequests)
      .set({ ...values, version: row.version + 1 })
      .where(
        and(
          eq(privacyRequests.id, row.id),
          eq(privacyRequests.version, row.version),
        ),
      )
      .returning();
    return updated;
  }
  async event(
    tx: Transaction,
    values: typeof privacyRequestEvents.$inferInsert,
  ) {
    await tx.insert(privacyRequestEvents).values(values);
  }
  async recordBelongs(
    tx: Transaction,
    customerId: string,
    record: { type: string; id: string },
  ) {
    const predicates = {
      CUSTOMER: sql`SELECT 1 FROM customers WHERE id::text = ${record.id} AND id = ${customerId}::uuid`,
      DOCUMENT: sql`SELECT 1 FROM documents WHERE id::text = ${record.id} AND ${customerId}::uuid IN (SELECT public.retention_document_owners(id))`,
      POLICY: sql`SELECT 1 FROM policies WHERE "policyNumber" = ${record.id} AND "customerId" = ${customerId}::uuid`,
      CLAIM: sql`SELECT 1 FROM claim_notifications c LEFT JOIN policies p ON p."policyNumber" = c."policyNumber" WHERE c."claimNumber" = ${record.id} AND coalesce(c."customerId", p."customerId") = ${customerId}::uuid`,
      PAYMENT: sql`SELECT 1 FROM payments WHERE id::text = ${record.id} AND "customerId" = ${customerId}::uuid`,
      REVIEW: sql`SELECT 1 FROM insurer_reviews r JOIN policies p ON p."policyNumber" = r."policyNumber" WHERE r.id::text = ${record.id} AND p."customerId" = ${customerId}::uuid`,
      SERVICE_REQUEST: sql`SELECT 1 FROM service_requests WHERE reference = ${record.id} AND "customerId" = ${customerId}::uuid`,
    };
    const predicate = predicates[record.type as keyof typeof predicates];
    if (!predicate) return false;
    const result = await tx.execute<{ valid: boolean }>(
      sql`SELECT EXISTS (${predicate}) AS valid`,
    );
    return result.rows[0]?.valid === true;
  }
}
