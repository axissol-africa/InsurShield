import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Env } from '../config/env.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { canonicalJson } from '../common/json/canonical-json.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { DeliveryKind, IntegrationTargetKind } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import { JobsRepository, type JobRow } from '../jobs/jobs.repository.js';
import { JobRunner } from '../jobs/job-runner.service.js';
import type { Transaction } from '../db/database.module.js';
import { CallbackSignatureService } from './callback-signature.service.js';
import {
  IntegrationEndpointRedirectError,
  IntegrationEndpointResolutionError,
  postJsonToEndpoint,
  resolvePublicIntegrationEndpoint,
  UnsafeIntegrationEndpointError,
} from './endpoint-safety.js';
import { IntegrationsRepository } from './integrations.repository.js';
import { IntegrationSecretsService } from './integration-secrets.service.js';

export const INTEGRATION_DELIVERY_JOB = 'integration.delivery';
const DEFAULT_MAX_ATTEMPTS = 5;

export interface QueueIntegrationDelivery {
  insurerId?: string | null;
  targetKind: IntegrationTargetKind;
  kind: DeliveryKind;
  /** The ID of the business record this delivery represents, never browser state. */
  referenceId: string;
  correlationId?: string | null;
  endpoint: string;
  /** Minimum necessary data for the named provider contract. */
  requestPayload: Record<string, unknown>;
  maxAttempts?: number;
}

export interface QueueInsurerQuoteRequest {
  insurerId: string;
  quoteRequestId: string;
  /** Minimum necessary customer risk data; uploaded documents stay in the document service. */
  requestPayload: Record<string, unknown>;
}

@Injectable()
export class IntegrationsService implements OnModuleInit {
  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly jobs: JobsRepository,
    private readonly runner: JobRunner,
    private readonly secrets: IntegrationSecretsService,
    private readonly signatures: CallbackSignatureService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.runner.register(INTEGRATION_DELIVERY_JOB, (job) => this.processJob(job));
  }

  /**
   * Writes the business outbox and its runner job in the caller's transaction.
   * A retried command sees the original row; it never overwrites a delivery
   * that might already be on its way to a provider.
   */
  async queue(tx: Transaction, input: QueueIntegrationDelivery) {
    const normalised = normalise(input);
    const idempotencyKey = deliveryKey(normalised);
    const requestHash = hash(normalised.requestPayload);
    const saved = await this.repository.enqueue(tx, {
      ...normalised,
      idempotencyKey,
      requestHash,
      maxAttempts: normalised.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    });
    if (!saved.created) {
      if (saved.row.requestHash !== requestHash) {
        throw ApiException.conflict(
          'INTEGRATION_DELIVERY_CONFLICT',
          'This integration event was already queued with different details.',
        );
      }
      return saved.row;
    }
    await this.jobs.enqueue(tx, {
      kind: INTEGRATION_DELIVERY_JOB,
      key: saved.row.id,
      payload: { deliveryId: saved.row.id },
      maxAttempts: normalised.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    });
    return saved.row;
  }

  /**
   * Queues the durable insurer hand-off once per insurer, not once per selected
   * product. Insurers without an enabled API still receive a visible manual
   * delivery exception rather than silently losing the customer's request.
   */
  async queueInsurerQuoteRequest(tx: Transaction, input: QueueInsurerQuoteRequest) {
    const configured = await this.repository.findInsurerDeliveryConfig(tx, input.insurerId);
    return this.queue(tx, {
      insurerId: input.insurerId,
      targetKind: 'INSURER_API',
      kind: 'QUOTE_REQUEST',
      referenceId: input.quoteRequestId,
      correlationId: input.quoteRequestId,
      endpoint: insurerQuoteRequestEndpoint(configured?.apiBaseUrl, input.insurerId),
      requestPayload: input.requestPayload,
    });
  }

  listForOperations() {
    return this.repository.listOperations();
  }

  listForInsurer(insurerId: string) {
    return this.repository.listForInsurer(insurerId);
  }

  async resolveManually(id: string, note: string, principal: Extract<Principal, { kind: 'staff' }>) {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new ApiException('VALIDATION_FAILED', 'Explain how the integration exception was completed manually.');
    }
    return this.repository.transaction(async (tx) => {
      const resolved = await this.repository.manualFallback(tx, id, principal.id, trimmed, new Date());
      if (!resolved) {
        const existing = await this.repository.findOperations(id, tx);
        if (!existing) throw ApiException.notFound('Integration delivery', id);
        throw ApiException.conflict(
          'INTEGRATION_DELIVERY_NOT_ACTIONABLE',
          'Only a failed integration delivery can be completed manually.',
        );
      }
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'integration_delivery.manual_fallback',
        entityType: 'INTEGRATION_DELIVERY',
        entityId: id,
        after: { status: resolved.status, attempt: resolved.attempt },
        note: 'A failed integration delivery was completed through the manual fallback process.',
        correlationId: resolved.correlationId ?? resolved.referenceId,
      });
      return resolved;
    });
  }

  /**
   * Verifies and records the generic envelope only. Later quote/payment/claim
   * batches own the typed event handler, so this layer cannot accidentally
   * mutate an insurance workflow based on an unreviewed payload shape.
   */
  async receiveInsurerCallback(input: {
    insurerId: string;
    eventId: string | undefined;
    eventType: string | undefined;
    correlationId: string | undefined;
    timestamp: string | undefined;
    signature: string | undefined;
    body: Record<string, unknown>;
  }) {
    if (!isRecord(input.body)) {
      throw new ApiException('INVALID_CALLBACK', 'The callback body must be a JSON object.', 400);
    }
    const eventId = headerValue(input.eventId, 'event ID', 200);
    const eventType = headerValue(input.eventType, 'event type', 120);
    const configured = await this.repository.findCallbackKey(input.insurerId);
    if (!configured) {
      // Do not reveal whether this is an onboarded insurer to a caller who has
      // not first proved its callback signature.
      throw new ApiException('INVALID_CALLBACK_SIGNATURE', 'This integration callback could not be verified.', 401);
    }
    this.signatures.verifyInbound(configured.publicSigningKey, {
      timestamp: input.timestamp,
      signature: input.signature,
      eventId,
      eventType,
      body: input.body,
    });
    const receipt = await this.repository.recordCallback({
      insurerId: input.insurerId,
      eventId,
      eventType,
      bodyHash: this.signatures.hashInboundEnvelope(eventId, eventType, input.body),
      correlationId: optionalHeader(input.correlationId, 200),
    });
    if (!receipt.accepted) {
      throw ApiException.conflict(
        'CALLBACK_EVENT_CONFLICT',
        'This callback event ID was already received with different contents.',
      );
    }
    return receipt;
  }

  private async processJob(job: JobRow): Promise<void> {
    const deliveryId = job.payload.deliveryId;
    if (typeof deliveryId !== 'string') throw new Error('Integration job is missing a delivery ID.');
    const now = new Date();
    const delivery = await this.repository.beginAttempt(deliveryId, now);
    // A duplicate or expired lease caught up after a successful attempt. It is
    // intentionally a no-op; the delivery's terminal state is authoritative.
    if (!delivery) return;

    try {
      const responseStatus = await this.dispatch(delivery);
      await this.repository.acknowledge(delivery.id, responseStatus, new Date());
    } catch (error) {
      const retryable = error instanceof IntegrationDeliveryError ? error.retryable : true;
      const exhausted = !retryable || job.attempt >= delivery.maxAttempts;
      await this.repository.recordFailure(delivery.id, safeError(error), exhausted);
      if (!exhausted) throw error;
    }
  }

  private async dispatch(delivery: {
    id: string;
    insurerId: string | null;
    targetKind: IntegrationTargetKind;
    endpoint: string;
    kind: DeliveryKind;
    requestPayload: unknown;
    idempotencyKey: string;
    correlationId: string | null;
  }): Promise<number> {
    if (delivery.targetKind !== 'INSURER_API' || !delivery.insurerId) {
      throw new IntegrationDeliveryError(
        'No live adapter is configured for this integration target. Complete this exception manually.',
        false,
      );
    }
    if (!isRecord(delivery.requestPayload)) {
      throw new IntegrationDeliveryError('The integration payload is invalid.', false);
    }
    const credential = await this.repository.findInsurerCredential(delivery.insurerId);
    if (!credential?.clientSecretEncrypted) {
      throw new IntegrationDeliveryError('The insurer API credential is not configured.', false);
    }
    const configuredEndpoint = insurerDeliveryEndpoint(credential.apiBaseUrl, delivery.insurerId, delivery.kind);
    if (delivery.endpoint !== configuredEndpoint) {
      throw new IntegrationDeliveryError('The insurer API endpoint no longer matches its approved integration record.', false);
    }
    let endpoint;
    try {
      endpoint = await resolvePublicIntegrationEndpoint(configuredEndpoint, credential.sandboxMode);
    } catch (error) {
      if (error instanceof UnsafeIntegrationEndpointError || error instanceof IntegrationEndpointRedirectError) {
        throw new IntegrationDeliveryError(error.message, false);
      }
      if (error instanceof IntegrationEndpointResolutionError) {
        throw new IntegrationDeliveryError(error.message, true);
      }
      throw error;
    }
    let secret: string;
    try {
      secret = this.secrets.decrypt(credential.clientSecretEncrypted);
    } catch {
      throw new IntegrationDeliveryError('The insurer API credential cannot be used.', false);
    }
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.get('INTEGRATION_TIMEOUT_MS', { infer: true }));
    try {
      const responseStatus = await postJsonToEndpoint(endpoint, {
        headers: {
          'content-type': 'application/json',
          'idempotency-key': delivery.idempotencyKey,
          'x-insurshield-client-id': credential.clientId,
          'x-insurshield-timestamp': timestamp,
          'x-insurshield-signature': this.signatures.signOutbound(secret, timestamp, delivery.requestPayload),
          ...(delivery.correlationId ? { 'x-correlation-id': delivery.correlationId } : {}),
        },
        body: canonicalJson(delivery.requestPayload),
        signal: controller.signal,
      });
      if (responseStatus < 200 || responseStatus >= 300) {
        throw new IntegrationDeliveryError(
          `The insurer API returned HTTP ${responseStatus}.`,
          responseStatus === 408 || responseStatus === 429 || responseStatus >= 500,
        );
      }
      return responseStatus;
    } catch (error) {
      if (error instanceof IntegrationEndpointRedirectError) {
        throw new IntegrationDeliveryError(error.message, false);
      }
      if (error instanceof IntegrationDeliveryError) throw error;
      throw new IntegrationDeliveryError('The insurer API could not be reached.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class IntegrationDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function normalise(input: QueueIntegrationDelivery): Required<QueueIntegrationDelivery> {
  const endpoint = input.endpoint.trim();
  const referenceId = input.referenceId.trim();
  if (!endpoint || !referenceId) {
    throw new ApiException('VALIDATION_FAILED', 'An integration delivery needs an endpoint and reference.');
  }
  if (input.targetKind === 'INSURER_API' && !input.insurerId) {
    throw new ApiException('VALIDATION_FAILED', 'An insurer API delivery needs an insurer.');
  }
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new ApiException('VALIDATION_FAILED', 'Integration delivery attempts must be between 1 and 10.');
  }
  return {
    ...input,
    insurerId: input.insurerId ?? null,
    endpoint,
    referenceId,
    correlationId: input.correlationId?.trim() || null,
    maxAttempts,
  };
}

function deliveryKey(input: Required<QueueIntegrationDelivery>): string {
  return createHash('sha256')
    .update(canonicalJson({
      targetKind: input.targetKind,
      insurerId: input.insurerId,
      kind: input.kind,
      referenceId: input.referenceId,
    }))
    .digest('hex');
}

function hash(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function insurerDeliveryEndpoint(apiBaseUrl: string | undefined, insurerId: string, kind: DeliveryKind): string {
  if (!apiBaseUrl) {
    // The processor stops before any network call when credentials are absent;
    // this stable endpoint exists solely to make the manual exception durable.
    return `https://manual.insurshield.invalid/insurers/${encodeURIComponent(insurerId)}/quote-requests`;
  }
  try {
    const path = insurerDeliveryPath(kind);
    return new URL(path, apiBaseUrl).toString();
  } catch {
    // Onboarding validates this field, but avoid turning a historic malformed
    // configuration into a missing outbox event.
    return `https://manual.insurshield.invalid/insurers/${encodeURIComponent(insurerId)}/quote-requests`;
  }
}

function insurerQuoteRequestEndpoint(apiBaseUrl: string | undefined, insurerId: string): string {
  return insurerDeliveryEndpoint(apiBaseUrl, insurerId, 'QUOTE_REQUEST');
}

function insurerDeliveryPath(kind: DeliveryKind): string {
  switch (kind) {
    case 'QUOTE_REQUEST':
      return '/quote-requests';
    case 'PAID_POLICY':
      return '/paid-policies';
    case 'CLAIM_NOTIFICATION':
      return '/claim-notifications';
    case 'VEHICLE_LOOKUP':
      return '/vehicle-lookups';
    case 'PAYMENT_CONFIRMATION':
      return '/payment-confirmations';
    case 'POLICY_ISSUED':
      return '/policies';
  }
}

function headerValue(value: string | undefined, label: string, max: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > max) {
    throw new ApiException('INVALID_CALLBACK', `The callback ${label} is required.`, 400);
  }
  return trimmed;
}

function optionalHeader(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An integration delivery failed.';
  return message.slice(0, 500);
}
