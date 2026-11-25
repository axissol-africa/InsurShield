import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { shownPhone } from '../common/auth/phone.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { AccountDataRepository } from './account-data.repository.js';

const documentDownloadPath = (documentId: string) => `/account/documents/${documentId}/download`;

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

@Injectable()
export class AccountDataService {
  constructor(
    private readonly repository: AccountDataRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async documentsFor(principal: Principal) {
    if (principal.kind !== 'customer') throw ApiException.forbidden();
    return this.customerDocuments(principal.id);
  }

  async download(principal: Principal, id: string) {
    if (principal.kind !== 'customer') throw ApiException.forbidden();
    const document = await this.documents.recordFor(principal, id);
    if (!document.url) throw ApiException.notFound('Document', id);
    return { url: document.url, statusCode: 302 };
  }

  async export(principal: Principal) {
    if (principal.kind !== 'customer' || !principal.emailVerified) throw ApiException.forbidden();
    const id = principal.id;
    return this.repository.snapshot(async (tx) => {
      const profile = await this.repository.profile(tx, id);
      if (!profile) throw ApiException.unauthorized();
      const preferences = await this.repository.preferences(tx, id);
      const vehicles = await this.repository.vehicles(tx, id);
      const quoted = await this.repository.quoteRecords(tx, id);
      const financial = await this.repository.financialRecords(tx, id);
      const service = await this.repository.serviceRecords(tx, id);
      const other = await this.repository.otherRecords(tx, id);
      const prefix = this.config.get('API_PREFIX', { infer: true }).replace(/^\/+|\/+$/g, '');
      const origin = this.config.get('BETTER_AUTH_URL', { infer: true });
      const documents = (await this.customerDocuments(id, tx)).map(({ downloadPath, ...document }) => ({
        ...document,
        downloadUrl: downloadPath ? new URL([prefix && `/${prefix}`, downloadPath].join(''), origin).href : null,
      }));

      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'customer.data_exported',
        entityType: 'CUSTOMER',
        entityId: id,
        after: { documents: documents.length, quoteRequests: quoted.requests.length, policies: financial.policies.length },
      });

      const products = groupBy(quoted.products, (row) => row.quoteRequestId);
      const answers = groupBy(quoted.answers, (row) => row.quoteRequestId);
      const declarations = groupBy(quoted.declarations, (row) => row.quoteRequestId);
      const evidence = groupBy(quoted.evidence, (row) => row.quoteRequestId);
      const quotations = groupBy(quoted.quotations, (row) => row.quoteRequestId);
      const updates = groupBy(service.updates, (row) => row.reference);
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        profile: { ...profile, phone: shownPhone(profile.phone) },
        ...preferences,
        vehicles,
        quoteRequests: quoted.requests.map((request) => ({
          ...request,
          selectedProducts: products.get(request.id) ?? [],
          answers: answers.get(request.id) ?? [],
          declarations: declarations.get(request.id) ?? [],
          evidence: evidence.get(request.id) ?? [],
          quotations: quotations.get(request.id) ?? [],
        })),
        ...financial,
        serviceRequests: service.requests.map((request) => ({ ...request, updates: updates.get(request.reference) ?? [] })),
        ...other,
        documents,
      };
    });
  }

  private async customerDocuments(id: string, tx?: Transaction) {
    return (await this.documents.listCustomerDocuments(id, tx)).map((record) => ({
      ...record, downloadPath: record.available ? documentDownloadPath(record.id) : null,
    }));
  }
}
