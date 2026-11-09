import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { Principal } from '../common/auth/auth.types.js';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DocumentsRepository } from './documents.repository.js';
import { summarise, withLinkIssueLog, type LinkIssueLog } from './link-issues.js';

/**
 * Records that a response handed out download links, once per response.
 *
 * `GET /documents/:id` audits itself, because asking for one document outright
 * is a different act from reading a page that happens to carry links. This
 * covers the rest: the list and detail responses that embed a signed link for
 * every document they mention, which would otherwise issue links with nothing
 * recording who received them.
 *
 * The entry is written after the response is produced, outside the request's
 * own transaction, so a failure to record can never fail the read.
 */
@Injectable()
export class LinkIssueInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LinkIssueInterceptor.name);

  constructor(
    private readonly audit: AuditService,
    private readonly documents: DocumentsRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();

    return withLinkIssueLog((log) =>
      next.handle().pipe(tap({ next: () => void this.flush(log, request.principal) })),
    );
  }

  private async flush(log: LinkIssueLog, principal: Principal | undefined): Promise<void> {
    const issued = summarise(log);
    if (!issued || !principal) return;
    try {
      await this.documents.transaction((tx) =>
        this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'document.links_issued',
          // The response, not a document: `DOCUMENT_UPLOAD` sets the same
          // precedent for an act that has no single document to point at.
          entityType: 'DOCUMENT_LINKS',
          entityId: randomUUID(),
          after: issued,
          note: 'Download links issued inside a response.',
        }),
      );
    } catch (error: unknown) {
      // The read already succeeded and its links are out; losing the entry is
      // bad, but failing the customer's page because of it would be worse.
      this.logger.error(`Could not record issued download links: ${String(error)}`);
    }
  }
}
