import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AUTH, AUTH_SETTINGS } from '../auth/auth.constants.js';
import type { Auth, AuthSettings } from '../auth/auth.instance.js';
import { createCredentialUser, normalizeEmail, requireStaffMfa } from '../auth/credential-user.js';
import { AuthService } from '../auth/auth.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { PERMISSIONS } from '../common/auth/permissions.js';
import { toContract } from '../common/contract.js';
import { isInsurerRole, type StaffRole } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import { isUniqueViolation } from '../db/errors.js';
import type { Transaction } from '../db/database.module.js';
import type { CreateStaffTeamDto, CreateStaffUserDto, UpdateStaffTeamDto, UpdateStaffUserDto } from './dto/staff.dto.js';
import { StaffRepository, type StaffRow, type TeamRow } from './staff.repository.js';

type ManagementScope =
  | { kind: 'platform'; role: 'SUPER_ADMIN' | 'ADMIN' }
  | { kind: 'insurer'; insurerId: string };

const STAFF_EMAIL_CONFLICT = 'STAFF_EMAIL_IN_USE';

/**
 * Changes to staff access live here rather than in a controller, so the
 * organisation boundary, session revocation and audit row cannot drift apart.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(AUTH_SETTINGS) private readonly authSettings: AuthSettings,
  ) {}

  async listUsers(principal: Principal) {
    const scope = this.scopeOf(principal);
    return (await this.staff.listStaff(scope.kind === 'insurer' ? scope.insurerId : undefined)).map(toStaffResponse);
  }

  async listTeams(principal: Principal) {
    const scope = this.scopeOf(principal);
    return (await this.staff.listTeams(scope.kind === 'insurer' ? scope.insurerId : undefined)).map(toTeamResponse);
  }

  /** Creates both the credential identity and its staff record, then mails a password-set link. */
  async createUser(principal: Principal, dto: CreateStaffUserDto) {
    const scope = this.scopeOf(principal);
    const email = normalizeEmail(dto.email);
    let created: StaffRow;

    try {
      created = await this.staff.transaction(async (tx) => {
        const insurerId = await this.resolveInsurerId(tx, scope, dto.role, dto.insurerId, dto.insurerId !== undefined);
        await this.assertTeam(tx, scope, dto.teamId, insurerId);

        if (await this.staff.emailInUse(tx, email)) {
          throw ApiException.conflict(STAFF_EMAIL_CONFLICT, 'This email address already has an account.');
        }

        // The temporary secret is never shown or logged. The only usable path
        // is Better Auth's one-time password-set email sent after commit.
        const identity = await createCredentialUser(tx, {
          email,
          name: dto.fullName,
          password: randomBytes(48).toString('base64url'),
        });
        await requireStaffMfa(tx, identity.id);
        const row = await this.staff.insertStaff(tx, {
          email: identity.email,
          fullName: dto.fullName,
          role: dto.role,
          insurerId,
          teamId: dto.teamId ?? null,
          userId: identity.id,
        });
        const stored = await this.staff.findStaff(row.id, tx);
        if (!stored) throw ApiException.notFound('Staff user', row.id);

        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'staff.created',
          entityType: 'STAFF_USER',
          entityId: stored.id,
          after: staffSnapshot(stored),
          note: dto.reason,
          correlationId: insurerId ?? stored.id,
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiException.conflict(STAFF_EMAIL_CONFLICT, 'This email address already has an account.');
      }
      throw error;
    }

    const invitationSent = await this.sendInvitation(created.email);
    return { ...toStaffResponse(created), invitationSent };
  }

  async updateUser(principal: Principal, id: string, dto: UpdateStaffUserDto) {
    const scope = this.scopeOf(principal);
    const updated = await this.staff.transaction(async (tx) => {
      const before = await this.staff.lockStaff(id, tx);
      this.assertTargetVisible(scope, before);

      const role = dto.role ?? before.role;
      const requestedInsurerId = dto.insurerId === undefined ? before.insurerId : dto.insurerId;
      const insurerId = await this.resolveInsurerId(
        tx,
        scope,
        role,
        requestedInsurerId,
        dto.insurerId !== undefined,
      );
      const teamId = dto.teamId === undefined
        ? (isInsurerRole(role) && insurerId === before.insurerId ? before.teamId : null)
        : dto.teamId;
      await this.assertTeam(tx, scope, teamId, insurerId);

      const isActive = dto.isActive ?? before.isActive;
      if (role === before.role && insurerId === before.insurerId && teamId === before.teamId && isActive === before.isActive) {
        throw ApiException.conflict('STAFF_UNCHANGED', 'Choose at least one staff access change to save.');
      }

      if (!isActive && before.isActive && before.userId) {
        await this.authService.revokeSessions(tx, before.userId);
      }
      const row = await this.staff.updateStaff(tx, id, { role, insurerId, teamId, isActive });
      if (!row) throw ApiException.notFound('Staff user', id);
      const after = await this.staff.findStaff(row.id, tx);
      if (!after) throw ApiException.notFound('Staff user', id);

      await this.auditAccessChanges(tx, principal, before, after, dto.reason);
      return after;
    });
    return toStaffResponse(updated);
  }

  async resendInvitation(principal: Principal, id: string, reason: string) {
    const scope = this.scopeOf(principal);
    const staff = await this.staff.transaction(async (tx) => {
      const target = await this.staff.lockStaff(id, tx);
      this.assertTargetVisible(scope, target);
      if (!target.isActive) {
        throw ApiException.conflict('STAFF_INACTIVE', 'Activate this staff account before sending an invitation.');
      }
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'staff.invitation_requested',
        entityType: 'STAFF_USER',
        entityId: target.id,
        after: staffSnapshot(target),
        note: reason,
        correlationId: target.insurerId ?? target.id,
      });
      return target;
    });
    const invitationSent = await this.sendInvitation(staff.email);
    if (!invitationSent) {
      throw new ApiException(
        'STAFF_INVITATION_UNAVAILABLE',
        'The account is ready, but the invitation could not be sent. Please try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { id: staff.id, invitationSent: true };
  }

  async createTeam(principal: Principal, dto: CreateStaffTeamDto) {
    const scope = this.scopeOf(principal);
    const insurerId = await this.resolveTeamInsurerId(scope, dto.insurerId);
    let created: TeamRow;
    try {
      created = await this.staff.transaction(async (tx) => {
        if (!(await this.staff.insurerExists(insurerId, tx))) throw ApiException.notFound('Insurer', insurerId);
        const row = await this.staff.insertTeam(tx, { insurerId, name: dto.name });
        const team = await this.staff.findTeam(row.id, tx);
        if (!team) throw ApiException.notFound('Team', row.id);
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'staff_team.created',
          entityType: 'STAFF_TEAM',
          entityId: team.id,
          after: teamSnapshot(team),
          note: dto.reason,
          correlationId: insurerId,
        });
        return team;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'staff_teams_insurerId_name_key')) {
        throw ApiException.conflict('STAFF_TEAM_EXISTS', 'A team with this name already exists for the insurer.');
      }
      throw error;
    }
    return toTeamResponse(created);
  }

  async updateTeam(principal: Principal, id: string, dto: UpdateStaffTeamDto) {
    const scope = this.scopeOf(principal);
    let updated: TeamRow;
    try {
      updated = await this.staff.transaction(async (tx) => {
        const before = await this.staff.lockTeam(id, tx);
        this.assertTeamVisible(scope, before);
        if (before.name === dto.name) throw ApiException.conflict('STAFF_TEAM_UNCHANGED', 'Enter a different team name.');
        const row = await this.staff.renameTeam(tx, id, dto.name);
        if (!row) throw ApiException.notFound('Team', id);
        const after = await this.staff.findTeam(row.id, tx);
        if (!after) throw ApiException.notFound('Team', id);
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'staff_team.updated',
          entityType: 'STAFF_TEAM',
          entityId: id,
          before: teamSnapshot(before),
          after: teamSnapshot(after),
          note: dto.reason,
          correlationId: after.insurerId,
        });
        return after;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'staff_teams_insurerId_name_key')) {
        throw ApiException.conflict('STAFF_TEAM_EXISTS', 'A team with this name already exists for the insurer.');
      }
      throw error;
    }
    return toTeamResponse(updated);
  }

  async removeTeam(principal: Principal, id: string, reason: string) {
    const scope = this.scopeOf(principal);
    await this.staff.transaction(async (tx) => {
      const team = await this.staff.lockTeam(id, tx);
      this.assertTeamVisible(scope, team);
      if (await this.staff.teamHasMembers(tx, team.id)) {
        throw ApiException.conflict('STAFF_TEAM_HAS_MEMBERS', 'Move every staff member before deleting this team.');
      }
      await this.staff.deleteTeam(tx, team.id);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'staff_team.deleted',
        entityType: 'STAFF_TEAM',
        entityId: team.id,
        before: teamSnapshot(team),
        note: reason,
        correlationId: team.insurerId,
      });
    });
    return { id, deleted: true };
  }

  private scopeOf(principal: Principal): ManagementScope {
    if (principal.kind !== 'staff') throw ApiException.forbidden();
    if (principal.role === 'SUPER_ADMIN' || principal.role === 'ADMIN') {
      return { kind: 'platform', role: principal.role };
    }
    if (principal.role === 'INSURER_ADMIN' && principal.insurerId) {
      return { kind: 'insurer', insurerId: principal.insurerId };
    }
    throw ApiException.forbidden();
  }

  private assertTargetVisible(scope: ManagementScope, target: StaffRow | undefined): asserts target is StaffRow {
    if (!target || (scope.kind === 'insurer' && target.insurerId !== scope.insurerId)) {
      throw ApiException.notFound('Staff user');
    }
    if (scope.kind === 'platform' && scope.role !== 'SUPER_ADMIN' && target.role === 'SUPER_ADMIN') {
      throw ApiException.forbidden('Only a super administrator may manage another super administrator.');
    }
  }

  private assertTeamVisible(scope: ManagementScope, team: TeamRow | undefined): asserts team is TeamRow {
    if (!team || (scope.kind === 'insurer' && team.insurerId !== scope.insurerId)) {
      throw ApiException.notFound('Team');
    }
  }

  private async resolveInsurerId(
    tx: Transaction,
    scope: ManagementScope,
    role: StaffRole,
    requested: string | null | undefined,
    explicitlyRequested: boolean,
  ): Promise<string | null> {
    if (scope.kind === 'insurer') {
      if (!isInsurerRole(role)) {
        throw ApiException.forbidden('An insurer administrator may assign only insurer roles.');
      }
      if (explicitlyRequested && requested !== scope.insurerId) {
        throw ApiException.forbidden('An insurer administrator may manage only their own insurer.');
      }
      return scope.insurerId;
    }

    if (role === 'SUPER_ADMIN' && scope.role !== 'SUPER_ADMIN') {
      throw ApiException.forbidden('Only a super administrator may assign that role.');
    }
    if (!isInsurerRole(role)) {
      if (explicitlyRequested && requested !== null) {
        throw new ApiException('STAFF_ROLE_SCOPE', 'An InsurShield role cannot be assigned to an insurer.');
      }
      return null;
    }
    if (!requested) {
      throw new ApiException('STAFF_INSURER_REQUIRED', 'Choose the insurer this staff account works for.');
    }
    if (!(await this.staff.insurerExists(requested, tx))) throw ApiException.notFound('Insurer', requested);
    return requested;
  }

  private async resolveTeamInsurerId(scope: ManagementScope, requested: string | undefined) {
    if (scope.kind === 'insurer') {
      if (requested !== undefined && requested !== scope.insurerId) {
        throw ApiException.forbidden('An insurer administrator may manage only their own insurer teams.');
      }
      return scope.insurerId;
    }
    if (!requested) throw new ApiException('STAFF_TEAM_INSURER_REQUIRED', 'Choose the insurer this team belongs to.');
    return requested;
  }

  private async assertTeam(tx: Transaction, scope: ManagementScope, teamId: string | null | undefined, insurerId: string | null) {
    if (!teamId) return;
    if (!insurerId) throw new ApiException('STAFF_TEAM_SCOPE', 'Only insurer staff may be assigned to an insurer team.');
    const team = await this.staff.findTeam(teamId, tx);
    if (!team || team.insurerId !== insurerId || (scope.kind === 'insurer' && team.insurerId !== scope.insurerId)) {
      throw ApiException.notFound('Team', teamId);
    }
  }

  private async auditAccessChanges(
    tx: Transaction,
    principal: Principal,
    before: StaffRow,
    after: StaffRow,
    reason: string,
  ) {
    const actor = auditActor(principal);
    const changed = (action: string) =>
      this.audit.write(tx, {
        actor,
        action,
        entityType: 'STAFF_USER',
        entityId: after.id,
        before: staffSnapshot(before),
        after: staffSnapshot(after),
        note: reason,
        correlationId: after.insurerId ?? after.id,
      });

    if (before.role !== after.role || before.insurerId !== after.insurerId) await changed('staff.role_changed');
    if (before.teamId !== after.teamId) await changed('staff.team_changed');
    if (before.isActive !== after.isActive) await changed('staff.status_changed');
  }

  private async sendInvitation(email: string): Promise<boolean> {
    const origin = this.authSettings.CORS_ORIGINS[0];
    try {
      await this.auth.api.requestPasswordReset({
        headers: new Headers({ origin }),
        body: { email, redirectTo: `${origin}/reset-password` },
      });
      return true;
    } catch {
      // The account and its audit record are already committed. An admin may
      // resend the invitation; logging the address would be needless exposure.
      this.logger.error('Could not send a staff invitation.');
      return false;
    }
  }
}

function permissionsFor(role: StaffRole) {
  return Object.entries(PERMISSIONS)
    .filter(([, grantees]) => (grantees as readonly string[]).includes(role))
    .map(([permission]) => permission);
}

function staffSnapshot(staff: StaffRow) {
  return {
    role: staff.role,
    permissions: permissionsFor(staff.role),
    insurerId: staff.insurerId,
    teamId: staff.teamId,
    isActive: staff.isActive,
  };
}

function teamSnapshot(team: TeamRow) {
  return { insurerId: team.insurerId, name: team.name };
}

function toStaffResponse(staff: StaffRow) {
  return {
    id: staff.id,
    email: staff.email,
    fullName: staff.fullName,
    role: toContract.staffRole(staff.role),
    insurerId: staff.insurerId,
    insurerName: staff.insurerName,
    isActive: staff.isActive,
    team: staff.team ? { id: staff.team.id, name: staff.team.name } : null,
    lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
    createdAt: staff.createdAt.toISOString(),
  };
}

function toTeamResponse(team: TeamRow) {
  return {
    id: team.id,
    insurerId: team.insurerId,
    insurerName: team.insurerName,
    name: team.name,
    createdAt: team.createdAt.toISOString(),
  };
}
