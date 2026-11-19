import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { integrationCallbacks, integrationDeliveries, insurerIntegrations } from '../db/schema.js';
import type { DeliveryKind, IntegrationTargetKind } from '../common/domain/enums.js';

type Executor = Database | Transaction;

const operationsColumns = {
  id: integrationDeliveries.id,
  insurerId: integrationDeliveries.insurerId,
  targetKind: integrationDeliveries.targetKind,
  kind: integrationDeliveries.kind,
  referenceId: integrationDeliveries.referenceId,
  requestHash: integrationDeliveries.requestHash,
  correlationId: integrationDeliveries.correlationId,
  attempt: integrationDeliveries.attempt,
  maxAttempts: integrationDeliveries.maxAttempts,
  status: integrationDeliveries.status,
  responseStatus: integrationDeliveries.responseStatus,
  error: integrationDeliveries.error,
  lastAttemptAt: integrationDeliveries.lastAttemptAt,
  deliveredAt: integrationDeliveries.deliveredAt,
  acknowledgedAt: integrationDeliveries.acknowledgedAt,
  resolvedAt: integrationDeliveries.resolvedAt,
  resolvedByStaffId: integrationDeliveries.resolvedByStaffId,
  resolutionNote: integrationDeliveries.resolutionNote,
  createdAt: integrationDeliveries.createdAt,
};

export type NewIntegrationDelivery = {
  insurerId?: string | null;
  targetKind: IntegrationTargetKind;
  kind: DeliveryKind;
  referenceId: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId?: string | null;
  endpoint: string;
  requestPayload: Record<string, unknown>;
  maxAttempts: number;
};

@Injectable()
export class IntegrationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async enqueue(tx: Transaction, input: NewIntegrationDelivery) {
    const [created] = await tx
      .insert(integrationDeliveries)
      .values(input)
      .onConflictDoNothing({ target: integrationDeliveries.idempotencyKey })
      .returning(operationsColumns);
    if (created) return { row: created, created: true };

    const [existing] = await tx
      .select({ ...operationsColumns, requestHash: integrationDeliveries.requestHash })
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.idempotencyKey, input.idempotencyKey));
    if (!existing) throw new Error('A delivery conflict did not return an existing delivery.');
    return { row: existing, created: false };
  }

  findOperations(id: string, executor: Executor = this.db) {
    return executor
      .select(operationsColumns)
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, id))
      .then((rows) => rows[0]);
  }

  listOperations(limit = 50, executor: Executor = this.db) {
    return executor
      .select(operationsColumns)
      .from(integrationDeliveries)
      .orderBy(asc(integrationDeliveries.status), sql`${integrationDeliveries.createdAt} DESC`)
      .limit(limit);
  }

  listForInsurer(insurerId: string, limit = 50, executor: Executor = this.db) {
    return executor
      .select(operationsColumns)
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.insurerId, insurerId))
      .orderBy(asc(integrationDeliveries.status), sql`${integrationDeliveries.createdAt} DESC`)
      .limit(limit);
  }

  /**
   * Marks exactly one pending delivery attempted. A stale runner or duplicate
   * job cannot make an acknowledged/failed delivery leave its terminal state.
   */
  async beginAttempt(id: string, now: Date) {
    const [delivery] = await this.db
      .update(integrationDeliveries)
      .set({ attempt: sql`${integrationDeliveries.attempt} + 1`, lastAttemptAt: now, error: null })
      .where(and(eq(integrationDeliveries.id, id), eq(integrationDeliveries.status, 'PENDING')))
      .returning();
    return delivery;
  }

  async acknowledge(id: string, responseStatus: number, now: Date) {
    await this.db
      .update(integrationDeliveries)
      .set({
        status: 'ACKNOWLEDGED',
        responseStatus,
        deliveredAt: now,
        acknowledgedAt: now,
        error: null,
      })
      .where(and(eq(integrationDeliveries.id, id), eq(integrationDeliveries.status, 'PENDING')));
  }

  async recordFailure(id: string, error: string, exhausted: boolean) {
    await this.db
      .update(integrationDeliveries)
      .set({ status: exhausted ? 'FAILED' : 'PENDING', error })
      .where(and(eq(integrationDeliveries.id, id), eq(integrationDeliveries.status, 'PENDING')));
  }

  async manualFallback(tx: Transaction, id: string, staffId: string, note: string, now: Date) {
    const [resolved] = await tx
      .update(integrationDeliveries)
      .set({ status: 'MANUAL_FALLBACK', resolvedByStaffId: staffId, resolvedAt: now, resolutionNote: note })
      .where(and(eq(integrationDeliveries.id, id), eq(integrationDeliveries.status, 'FAILED')))
      .returning(operationsColumns);
    return resolved;
  }

  /** Private adapter read: never use this projection in a controller response. */
  findInsurerCredential(insurerId: string) {
    return this.db
      .select({
        clientId: insurerIntegrations.clientId,
        clientSecretEncrypted: insurerIntegrations.clientSecretEncrypted,
        sandboxMode: insurerIntegrations.sandboxMode,
      })
      .from(insurerIntegrations)
      .where(eq(insurerIntegrations.insurerId, insurerId))
      .then((rows) => rows[0]);
  }

  /**
   * Delivery configuration is read in the caller's transaction so a request
   * cannot be committed against a half-updated insurer integration record.
   * No credentials are selected here.
   */
  findInsurerDeliveryConfig(tx: Transaction, insurerId: string) {
    return tx
      .select({ apiBaseUrl: insurerIntegrations.apiBaseUrl })
      .from(insurerIntegrations)
      .where(eq(insurerIntegrations.insurerId, insurerId))
      .then((rows) => rows[0]);
  }

  async recordCallback(input: {
    insurerId: string;
    eventId: string;
    eventType: string;
    bodyHash: string;
    correlationId?: string | null;
  }) {
    const [created] = await this.db
      .insert(integrationCallbacks)
      .values(input)
      .onConflictDoNothing({ target: [integrationCallbacks.insurerId, integrationCallbacks.eventId] })
      .returning({ bodyHash: integrationCallbacks.bodyHash });
    if (created) return { accepted: true, replayed: false };

    const [existing] = await this.db
      .select({ bodyHash: integrationCallbacks.bodyHash })
      .from(integrationCallbacks)
      .where(
        and(
          eq(integrationCallbacks.insurerId, input.insurerId),
          eq(integrationCallbacks.eventId, input.eventId),
        ),
      );
    return { accepted: existing?.bodyHash === input.bodyHash, replayed: true };
  }

  findCallbackKey(insurerId: string) {
    return this.db
      .select({ publicSigningKey: insurerIntegrations.publicSigningKey })
      .from(insurerIntegrations)
      .where(eq(insurerIntegrations.insurerId, insurerId))
      .then((rows) => rows[0]);
  }
}
