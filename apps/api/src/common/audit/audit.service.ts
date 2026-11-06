import { Injectable } from '@nestjs/common';
import { auditLogs, stateHistory } from '../../db/schema.js';
import type { Transaction } from '../../db/database.module.js';
import type { AuditEvent, StateTransition } from './audit.types.js';

const SENSITIVE_KEY = /(?:password|secret|token|private|credential|email|phone|mobile|address|description|storagekey|checksum|url|providerreference)/i;

/**
 * Writes the platform's immutable, privacy-safe operational history.
 *
 * Callers must provide the same transaction that changes the business record.
 * This makes an audit row an all-or-nothing part of the operation rather than
 * an eventually-consistent activity log.
 */
@Injectable()
export class AuditService {
  async write(tx: Transaction, event: AuditEvent): Promise<void> {
    await tx.insert(auditLogs).values({
      actorType: event.actor.type,
      actorId: event.actor.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: sanitize(event.before),
      after: sanitize(event.after),
      note: event.note?.trim() || null,
      correlationId: event.correlationId?.trim() || null,
    });
  }

  async transition(tx: Transaction, transition: StateTransition): Promise<void> {
    await tx.insert(stateHistory).values({
      entityType: transition.entityType,
      entityId: transition.entityId,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      actorType: transition.actor.type,
      actorId: transition.actor.id,
      note: transition.note?.trim() || null,
      correlationId: transition.correlationId?.trim() || null,
    });
    await this.write(tx, {
      actor: transition.actor,
      action: `${transition.entityType.toLowerCase()}.status_changed`,
      entityType: transition.entityType,
      entityId: transition.entityId,
      before: transition.fromStatus === null ? null : { status: transition.fromStatus },
      after: { status: transition.toStatus },
      note: transition.note,
      correlationId: transition.correlationId,
    });
  }
}

/**
 * The audit API never reads raw snapshots, but this final safety net prevents a
 * future caller from accidentally persisting credentials or personal contact
 * detail. Entity-specific callers still use small allowlisted snapshots.
 */
function sanitize(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || item === undefined) continue;
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      safe[key] = item;
    } else if (Array.isArray(item)) {
      safe[key] = item.filter((part) => typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean');
    }
  }
  return safe;
}
