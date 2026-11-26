import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { Env } from '../config/env.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import { SupportRepository, type FoundRecord } from './support.repository.js';

export interface SupportContact {
  /** The external help desk; each part null until it is configured. */
  helpDesk: { email: string | null; phone: string | null; hours: string | null };
  /** What the customer has in progress, to quote to the help desk. */
  references: { type: FoundRecord['type']; reference: string; status: string; createdAt: string }[];
}

/**
 * The hand-over to the external help desk (decision 13). InsurShield does not
 * run support itself: it tells the customer where to go and which references
 * to quote, and lets a help-desk agent find the record a reference names.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly repository: SupportRepository,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  helpDesk(): SupportContact['helpDesk'] {
    return {
      email: this.config.get('HELP_DESK_EMAIL', { infer: true }) ?? null,
      phone: this.config.get('HELP_DESK_PHONE', { infer: true }) ?? null,
      hours: this.config.get('HELP_DESK_HOURS', { infer: true }) ?? null,
    };
  }

  async contact(customer: CustomerPrincipal): Promise<SupportContact> {
    const records = await this.repository.openRecordsOf(customer.id);
    return {
      helpDesk: this.helpDesk(),
      references: records.map((record) => ({
        type: record.type,
        reference: record.reference,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Finds what a reference names, for an InsurShield administrator on a support
   * case. Every look-up is audited with who looked and the reason they gave
   * (US-ADM-012), whether or not anything was found.
   */
  async findRecord(principal: Principal, reference: string, reason: string) {
    // References are issued in capitals; one read out over the phone may not be typed that way.
    let found = await this.repository.findByReference(reference);
    if (found.length === 0 && reference !== reference.toUpperCase()) found = await this.repository.findByReference(reference.toUpperCase());
    // Written before anything is shown, and not swallowed: no record leaves unaudited.
    await this.repository.transaction((tx) => this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'support.record_lookup',
      entityType: found[0]?.type ?? 'RECORD',
      entityId: reference,
      after: { found: found.length },
      note: reason,
      correlationId: reference,
    }));
    const customers = new Map((await this.repository.customersById([...new Set(found.flatMap((record) => record.customerId ?? []))])).map((row) => [row.id, row]));
    const insurers = new Map((await this.repository.insurerNames([...new Set(found.flatMap((record) => record.insurerId ?? []))])).map((row) => [row.id, row.name]));
    return found.map((record) => ({
      type: record.type,
      reference: record.reference,
      status: record.status,
      customer: record.customerId ? (customers.get(record.customerId) ?? null) : null,
      insurer: record.insurerId ? (insurers.get(record.insurerId) ?? null) : null,
      createdAt: record.createdAt.toISOString(),
    }));
  }
}
