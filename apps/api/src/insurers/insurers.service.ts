import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InsurerStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { CreateInsurerDto, UpdateInsurerDto } from './dto/insurer.dto.js';

/**
 * What an unauthenticated visitor may see.
 *
 * The customer site needs enough to price a quote and to contact the claims
 * desk. It does not need the company's tax or registration numbers, so those
 * are absent here rather than merely unused — see ADMIN_SELECT below.
 *
 * `ratePercentage` is a Decimal in the database and must reach the client as a
 * number, because the premium engine multiplies by it. The credentials in
 * `InsurerIntegration` are never selected anywhere — they must not leave the
 * server at all.
 */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  tradingName: true,
  status: true,
  ratePercentage: true,
  quoteValidityDays: true,
  coverage: true,
  plan: true,
  website: true,
  logoUrl: true,
  ncdAccepted: true,
  inspectionRule: true,
  inspectionTiming: true,
  inspectionMethod: true,
  icon: true,
  isBestValue: true,
  benefits: true,
  contact: {
    select: {
      tagline: true, contactPerson: true, role: true, phone: true, mobile: true,
      whatsapp: true, email: true, address: true, hours: true,
    },
  },
} satisfies Prisma.InsurerSelect;

/**
 * The full record, for staff only. Adds the licence, registration and tax
 * details captured during onboarding.
 */
const ADMIN_SELECT = {
  ...PUBLIC_SELECT,
  licenceNumber: true,
  licenceExpiry: true,
  registrationNumber: true,
  tpin: true,
} satisfies Prisma.InsurerSelect;

type InsurerRow = Prisma.InsurerGetPayload<{ select: typeof PUBLIC_SELECT }> &
  Partial<Prisma.InsurerGetPayload<{ select: typeof ADMIN_SELECT }>>;

@Injectable()
export class InsurersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Decimal -> number, and the status enum back to the wording the UI uses. */
  private serialise(insurer: InsurerRow) {
    const STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', DELETED: 'Deleted' } as const;
    return {
      ...insurer,
      status: STATUS_LABEL[insurer.status],
      ratePercentage: insurer.ratePercentage.toNumber(),
      ...(insurer.licenceExpiry !== undefined
        ? { licenceExpiry: insurer.licenceExpiry?.toISOString() ?? null }
        : {}),
    };
  }

  /** Every insurer the admin portal manages, deleted ones excluded. Staff only. */
  async list() {
    const rows = await this.prisma.insurer.findMany({
      where: { status: { not: InsurerStatus.DELETED } },
      orderBy: { name: 'asc' },
      select: ADMIN_SELECT,
    });
    return rows.map((row) => this.serialise(row));
  }

  /** Active insurers only — this is what a quote request fans out to. */
  async directory() {
    const rows = await this.prisma.insurer.findMany({
      where: { status: InsurerStatus.ACTIVE },
      orderBy: { name: 'asc' },
      select: PUBLIC_SELECT,
    });
    return rows.map((row) => this.serialise(row));
  }

  /** One insurer in full. Staff only. */
  async get(id: string) {
    const insurer = await this.prisma.insurer.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!insurer || insurer.status === InsurerStatus.DELETED) {
      throw ApiException.notFound('Insurer', id);
    }
    return this.serialise(insurer);
  }

  /**
   * The signed-in insurer's own record, for its portal. Scoped by the caller's
   * staff record, so it can only ever return the insurer they belong to.
   */
  async profile(insurerId: string) {
    const insurer = await this.prisma.insurer.findUnique({
      where: { id: insurerId },
      select: ADMIN_SELECT,
    });
    if (!insurer) throw ApiException.notFound('Insurer', insurerId);
    return this.serialise(insurer);
  }

  async create(dto: CreateInsurerDto) {
    const { contact, licenceExpiry, ...rest } = dto;

    const existing = await this.prisma.insurer.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw ApiException.conflict('INSURER_EXISTS', `An insurer named ${dto.name} already exists.`);
    }

    const insurer = await this.prisma.insurer.create({
      data: {
        ...rest,
        licenceExpiry: licenceExpiry ? new Date(licenceExpiry) : null,
        benefits: dto.benefits ?? [],
        contact: { create: contact },
      },
      select: ADMIN_SELECT,
    });
    return this.serialise(insurer);
  }

  async update(id: string, dto: UpdateInsurerDto) {
    await this.get(id);
    const { contact, licenceExpiry, ...rest } = dto;

    const insurer = await this.prisma.insurer.update({
      where: { id },
      data: {
        ...rest,
        ...(licenceExpiry !== undefined
          ? { licenceExpiry: licenceExpiry ? new Date(licenceExpiry) : null }
          : {}),
        ...(contact ? { contact: { upsert: { create: contact, update: contact } } } : {}),
      },
      select: ADMIN_SELECT,
    });
    return this.serialise(insurer);
  }

  async setStatus(id: string, status: InsurerStatus) {
    await this.get(id);
    const insurer = await this.prisma.insurer.update({
      where: { id },
      data: { status, deletedAt: status === InsurerStatus.DELETED ? new Date() : null },
      select: ADMIN_SELECT,
    });
    return this.serialise(insurer);
  }

  /**
   * Soft delete. Deactivation stops new deliveries immediately but prior
   * quotes, claims and policies stay readable, per INSURER_API_INTEGRATION.md.
   */
  async remove(id: string) {
    await this.setStatus(id, InsurerStatus.DELETED);
    return { id, status: 'Deleted' as const };
  }
}
