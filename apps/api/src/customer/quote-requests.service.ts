import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { fromContract } from '../common/contract.js';
import { kwachaToNgwee } from '../common/money.js';
import type { Transaction } from '../db/database.module.js';
import { newReference } from '../payments/domain/payment.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { addDays, coverPeriod, REQUEST_VALIDITY_DAYS } from './domain/cover-period.js';
import { ncdCodeRefusal, normaliseNcdCode } from './domain/ncd-code.js';
import { findVehicleByPlate, plateSearchPrefix } from './domain/plate-match.js';
import { CHOOSE_A_COVER_PERIOD, CHOOSE_A_COVER_TYPE, type SubmitQuoteRequestDto, type VehicleDetailsDto } from './dto/customer.dto.js';
import { toQuoteRequestResponse, type QuoteRequestResponse, type QuoteWithDocument } from './dto/quote-request.response.js';
import {
  QuoteRequestsRepository,
  type NewQuoteRequest,
  type NewShot,
  type NewVehicle,
  type RequestWithParties,
  type VehicleRow,
} from './quote-requests.repository.js';

/**
 * A customer's quote requests.
 *
 * One request, one distribution: each active insurer gets an identical copy at
 * the same moment (DEC-016), which is what makes the comparison fair and is why
 * recipients and photos are written in the same transaction as the request.
 */
@Injectable()
export class QuoteRequestsService {
  private readonly logger = new Logger(QuoteRequestsService.name);

  constructor(
    private readonly repository: QuoteRequestsRepository,
    private readonly documents: DocumentsService,
  ) {}

  async list(customerId: string): Promise<QuoteRequestResponse[]> {
    return this.responses(await this.repository.listForCustomer(customerId));
  }

  async get(customerId: string, id: string): Promise<QuoteRequestResponse> {
    const row = await this.repository.findOwned(customerId, id);
    if (!row) throw ApiException.notFound('Quote request', id);
    const [response] = await this.responses([row]);
    return response;
  }

  async submit(customer: CustomerPrincipal, dto: SubmitQuoteRequestDto): Promise<QuoteRequestResponse> {
    const insuranceType = fromContract.insuranceType(dto.insuranceType);
    if (!insuranceType) throw new ApiException('BAD_REQUEST', CHOOSE_A_COVER_TYPE);
    const coverageDuration = fromContract.coverageDuration(dto.coverageDurationId);
    if (!coverageDuration) throw new ApiException('BAD_REQUEST', CHOOSE_A_COVER_PERIOD);
    const shots = dto.inspectionShots ?? [];
    const submittedAt = new Date();
    const dates = coverPeriod(dto.policyDates, coverageDuration, submittedAt);

    const response = await this.repository.transaction(async (tx) => {
      const insurerIds = await this.activeInsurerIds(tx);
      await this.documents.assertAttachable(tx, customer, shots.map((shot) => shot.documentId), 'INSPECTION_PHOTO');
      const vehicle = await this.upsertVehicle(tx, dto.vehicleDetails);
      const ncd = await this.usableNcdCode(tx, customer.id, dto.ncdCode);
      return this.distribute(
        tx,
        {
          id: newReference('QR', submittedAt, randomInt),
          status: 'SUBMITTED',
          submittedAt,
          expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
          customerId: customer.id,
          vehicleId: vehicle.id,
          vehicleValueMinor: kwachaToNgwee(dto.vehicleValue),
          vehicleUsage: dto.vehicleUsage,
          insuranceType,
          coverageDuration,
          matchRtsaAnniversary: dto.matchRtsaAnniversary ?? false,
          rtsaRegistrationDate: dto.rtsaRegistrationDate ? new Date(dto.rtsaRegistrationDate) : null,
          policyStartDate: dates.startDate,
          policyEndDate: dates.endDate,
          coverageDays: dates.days,
          ncdCode: ncd?.code ?? null,
          ncdPercentage: ncd?.percentage ?? null,
          photosCapturedAt: dto.photosCapturedAt ? new Date(dto.photosCapturedAt) : null,
        },
        insurerIds,
        shots,
      );
    });

    this.logger.log(
      `Quote request ${response.id} distributed to ${response.insurerIds.length} insurers with ${shots.length} photos`,
    );
    return response;
  }

  /**
   * Sends the same vehicle out again after the original quotes lapsed. The new
   * request links back to the old one, so the history of what was asked and
   * when stays intact rather than being overwritten.
   */
  async requote(customerId: string, id: string): Promise<QuoteRequestResponse> {
    const response = await this.repository.transaction(async (tx) => {
      const original = await this.repository.lockOwned(tx, customerId, id);
      if (!original) throw ApiException.notFound('Quote request', id);

      const [sentAgain] = await this.repository.requoteLinksOf([original.id], tx);
      if (sentAgain) {
        throw ApiException.conflict('ALREADY_REQUOTED', `This request was already sent again as ${sentAgain.id}.`);
      }

      const insurerIds = await this.activeInsurerIds(tx);
      const submittedAt = new Date();
      return this.distribute(
        tx,
        {
          id: newReference('QR', submittedAt, randomInt),
          status: 'SUBMITTED',
          submittedAt,
          expiresAt: addDays(submittedAt, REQUEST_VALIDITY_DAYS),
          customerId,
          vehicleId: original.vehicleId,
          vehicleValueMinor: original.vehicleValueMinor,
          vehicleUsage: original.vehicleUsage,
          insuranceType: original.insuranceType,
          coverageDuration: original.coverageDuration,
          matchRtsaAnniversary: original.matchRtsaAnniversary,
          rtsaRegistrationDate: original.rtsaRegistrationDate,
          requotedFromId: original.id,
        },
        insurerIds,
      );
    });

    this.logger.log(`Requote ${id} -> ${response.id} for ${response.insurerIds.length} insurers`);
    return response;
  }

  /** Every insurer accepting requests now; none at all is a refusal. */
  async activeInsurerIds(tx: Transaction): Promise<string[]> {
    const insurerIds = await this.repository.activeInsurerIds(tx);
    if (insurerIds.length === 0) {
      throw ApiException.conflict(
        'NO_ACTIVE_INSURERS',
        'No insurers are currently accepting requests. Please try again later.',
      );
    }
    return insurerIds;
  }

  /** Writes a request with its recipients and photos in `tx` and reads it back for the response. */
  async distribute(
    tx: Transaction,
    request: NewQuoteRequest,
    insurerIds: string[],
    shots: NewShot[] = [],
  ): Promise<QuoteRequestResponse> {
    const created = await this.repository.insertRequest(tx, request);
    await this.repository.insertRecipients(tx, created.id, insurerIds);
    await this.repository.insertShots(tx, created.id, shots);
    const row = await this.repository.findOwned(created.customerId, created.id, tx);
    if (!row) throw new Error(`Quote request ${created.id} is missing inside its own transaction`);
    const [response] = await this.responses([row], tx);
    return response;
  }

  /**
   * One row per plate, so a returning customer's vehicle keeps its history
   * instead of accumulating near-duplicates. The details the customer just
   * confirmed win, because they have seen them and the stored copy may predate
   * a respray or a re-registration.
   */
  private async upsertVehicle(tx: Transaction, details: VehicleDetailsDto): Promise<VehicleRow> {
    const vehicle: NewVehicle = {
      plateNumber: details.plateNumber.trim(),
      make: details.make.trim(),
      model: details.model.trim(),
      year: details.year.trim(),
      color: details.color?.trim() ?? null,
      registrationCountry: details.registrationCountry?.trim() || null,
      chassisNumber: details.chassisNumber?.trim() ?? null,
      engineNumber: details.engineNumber?.trim() ?? null,
      registrationDate: details.registrationDate ? new Date(details.registrationDate) : null,
      rtsaAnniversaryDate: details.rtsaAnniversaryDate ? new Date(details.rtsaAnniversaryDate) : null,
    };
    const candidates = await this.repository.vehicleCandidates(tx, plateSearchPrefix(vehicle.plateNumber));
    const existing = findVehicleByPlate(candidates, vehicle.plateNumber);
    return existing
      ? this.repository.updateVehicle(tx, existing.id, vehicle)
      : this.repository.insertVehicle(tx, vehicle);
  }

  /** The customer's own code behind `ncdCode`, if it is still usable; anything else is dropped. */
  private async usableNcdCode(tx: Transaction, customerId: string, code: string | undefined) {
    if (!code?.trim()) return null;
    const found = await this.repository.findNcdCodeIssuedTo(tx, normaliseNcdCode(code), customerId);
    if (!found || ncdCodeRefusal(found, new Date())) return null;
    return { code: found.code, percentage: found.percentage };
  }

  private async responses(rows: RequestWithParties[], tx?: Transaction): Promise<QuoteRequestResponse[]> {
    const ids = rows.map((row) => row.request.id);
    const recipients = await this.repository.recipientsOf(ids, tx);
    const quotes = await this.repository.quotesOf(ids, tx);
    const links = await this.repository.requoteLinksOf(ids, tx);

    const responses: QuoteRequestResponse[] = [];
    for (const row of rows) {
      const withDocuments: QuoteWithDocument[] = [];
      for (const quote of quotes.filter((candidate) => candidate.quoteRequestId === row.request.id)) {
        withDocuments.push({ ...quote, document: await this.documents.record(quote.documentId) });
      }
      responses.push(
        toQuoteRequestResponse(
          row,
          recipients.filter((recipient) => recipient.quoteRequestId === row.request.id),
          withDocuments,
          links.find((link) => link.requotedFromId === row.request.id)?.id ?? null,
        ),
      );
    }
    return responses;
  }
}
