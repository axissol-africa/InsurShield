import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { isUniqueViolation } from '../db/errors.js';
import type { InsurerStatus } from '../common/domain/enums.js';
import type { StaffRoleName } from '../common/auth/auth.types.js';
import { toInsurerChanges, toNewContact, toNewInsurer, type CreateInsurerDto, type UpdateInsurerDto } from './dto/insurer.dto.js';
import { toInsurerResponse, toPublicInsurerResponse } from './dto/insurer-response.dto.js';
import { InsurersRepository } from './insurers.repository.js';

const NAME_CONSTRAINT = 'insurers_name_key';

// Names are unique by constraint, so two requests for one name at once get one insurer and one refusal.
const nameClash = (name: string | undefined) => (error: unknown): never => {
  if (name !== undefined && isUniqueViolation(error, NAME_CONSTRAINT)) {
    throw ApiException.conflict('INSURER_EXISTS', `An insurer named ${name} already exists.`);
  }
  throw error;
};

@Injectable()
export class InsurersService {
  constructor(private readonly insurers: InsurersRepository) {}

  /** Every insurer the admin portal manages, deleted ones excluded. Staff only. */
  async list() {
    return (await this.insurers.listNotDeleted()).map(toInsurerResponse);
  }

  /** Active insurers only — this is what a quote request fans out to. */
  async directory() {
    return (await this.insurers.listPublic('ACTIVE')).map(toPublicInsurerResponse);
  }

  /** One insurer in full. Staff only. */
  async get(id: string) {
    const insurer = await this.insurers.find(id);
    if (!insurer || insurer.status === 'DELETED') {
      throw ApiException.notFound('Insurer', id);
    }
    return toInsurerResponse(insurer);
  }

  /**
   * The signed-in insurer's own record, for its portal. Scoped by the caller's
   * staff record, so it can only ever return the insurer they belong to.
   */
  async profile(insurerId: string) {
    const insurer = await this.insurers.find(insurerId);
    if (!insurer) throw ApiException.notFound('Insurer', insurerId);
    return toInsurerResponse(insurer);
  }

  async create(dto: CreateInsurerDto) {
    const insurer = await this.insurers
      .transaction((tx) => this.insurers.insert(tx, toNewInsurer(dto), toNewContact(dto.contact)))
      .catch(nameClash(dto.name));
    return toInsurerResponse(insurer);
  }

  async update(id: string, dto: UpdateInsurerDto) {
    const insurer = await this.insurers.transaction(async (tx) => {
      const row = await this.insurers.update(tx, id, toInsurerChanges(dto));
      if (!row) throw ApiException.notFound('Insurer', id);
      const contact = dto.contact
        ? await this.insurers.upsertContact(tx, id, toNewContact(dto.contact))
        : await this.insurers.findContact(tx, id);
      return { ...row, contact };
    }).catch(nameClash(dto.name));
    return toInsurerResponse(insurer);
  }

  /** Deleting is for super admins on either route, so an admin cannot soft-delete through a status change. */
  async setStatus(id: string, status: InsurerStatus, role: StaffRoleName) {
    if (status === 'DELETED' && role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    const insurer = await this.insurers.transaction(async (tx) => {
      const row = await this.insurers.update(tx, id, { status, deletedAt: status === 'DELETED' ? new Date() : null });
      if (!row) throw ApiException.notFound('Insurer', id);
      return { ...row, contact: await this.insurers.findContact(tx, id) };
    });
    return toInsurerResponse(insurer);
  }

  /**
   * Soft delete. Deactivation stops new deliveries immediately but prior
   * quotes, claims and policies stay readable, per INSURER_API_INTEGRATION.md.
   */
  async remove(id: string) {
    await this.setStatus(id, 'DELETED', 'SUPER_ADMIN');
    return { id, status: 'Deleted' as const };
  }
}
