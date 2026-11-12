import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, lt } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { approvalRequests, staffUsers } from '../db/schema.js';
import type { ApprovalAction } from '../common/domain/enums.js';
import type { ApprovalRequestInput } from './approval.types.js';

type Executor = Database | Transaction;

const requestColumns = {
  id: approvalRequests.id,
  action: approvalRequests.action,
  status: approvalRequests.status,
  targetType: approvalRequests.targetType,
  targetId: approvalRequests.targetId,
  payload: approvalRequests.payload,
  requestedByStaffId: approvalRequests.requestedByStaffId,
  requestedReason: approvalRequests.requestedReason,
  decidedByStaffId: approvalRequests.decidedByStaffId,
  decisionReason: approvalRequests.decisionReason,
  expiresAt: approvalRequests.expiresAt,
  decidedAt: approvalRequests.decidedAt,
  executedAt: approvalRequests.executedAt,
  createdAt: approvalRequests.createdAt,
};

export type ApprovalRequestRow = NonNullable<Awaited<ReturnType<ApprovalsRepository['find']>>>;

@Injectable()
export class ApprovalsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async create(tx: Transaction, input: ApprovalRequestInput & { expiresAt: Date }) {
    const [created] = await tx
      .insert(approvalRequests)
      .values({ ...input, payload: input.payload })
      .returning(requestColumns);
    return created;
  }

  async find(id: string, executor: Executor = this.db) {
    const [row] = await executor.select(requestColumns).from(approvalRequests).where(eq(approvalRequests.id, id));
    return row;
  }

  async lock(id: string, tx: Transaction) {
    const [row] = await tx
      .select(requestColumns)
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .for('update', { of: approvalRequests });
    return row;
  }

  async expirePending(tx: Transaction, now: Date) {
    await tx
      .update(approvalRequests)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(and(eq(approvalRequests.status, 'PENDING'), lt(approvalRequests.expiresAt, now)));
  }

  async markRejected(tx: Transaction, id: string, staffId: string, reason: string | null, decidedAt: Date) {
    const [row] = await tx
      .update(approvalRequests)
      .set({ status: 'REJECTED', decidedByStaffId: staffId, decisionReason: reason, decidedAt, updatedAt: decidedAt })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning(requestColumns);
    return row;
  }

  async markExecuted(tx: Transaction, id: string, staffId: string, reason: string | null, decidedAt: Date) {
    const [row] = await tx
      .update(approvalRequests)
      .set({
        status: 'EXECUTED',
        decidedByStaffId: staffId,
        decisionReason: reason,
        decidedAt,
        executedAt: decidedAt,
        updatedAt: decidedAt,
      })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning(requestColumns);
    return row;
  }

  /** A pending duplicate is a conflict, while earlier concluded requests stay as history. */
  pendingFor(tx: Transaction, action: ApprovalAction, targetType: string, targetId: string) {
    return tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.action, action),
        eq(approvalRequests.targetType, targetType),
        eq(approvalRequests.targetId, targetId),
        eq(approvalRequests.status, 'PENDING'),
      ))
      .limit(1);
  }

  async listPending(executor: Executor = this.db) {
    return executor
      .select({ ...requestColumns, requestedByName: staffUsers.fullName })
      .from(approvalRequests)
      .innerJoin(staffUsers, eq(staffUsers.id, approvalRequests.requestedByStaffId))
      .where(eq(approvalRequests.status, 'PENDING'))
      .orderBy(asc(approvalRequests.createdAt));
  }
}
