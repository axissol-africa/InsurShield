import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { authSessions, authUsers, customers, insurers, staffTeams, staffUsers } from '../db/schema.js';

type Executor = Database | Transaction;

const teamColumns = {
  id: staffTeams.id,
  insurerId: staffTeams.insurerId,
  name: staffTeams.name,
  createdAt: staffTeams.createdAt,
  updatedAt: staffTeams.updatedAt,
};

const staffColumns = {
  id: staffUsers.id,
  email: staffUsers.email,
  fullName: staffUsers.fullName,
  role: staffUsers.role,
  insurerId: staffUsers.insurerId,
  isActive: staffUsers.isActive,
  teamId: staffUsers.teamId,
  userId: staffUsers.userId,
  lastLoginAt: staffUsers.lastLoginAt,
  createdAt: staffUsers.createdAt,
  updatedAt: staffUsers.updatedAt,
  team: teamColumns,
  insurerName: insurers.name,
};

export type StaffRow = NonNullable<Awaited<ReturnType<StaffRepository['findStaff']>>>;
export type TeamRow = NonNullable<Awaited<ReturnType<StaffRepository['findTeam']>>>;

@Injectable()
export class StaffRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  listStaff(insurerId?: string) {
    return this.db
      .select(staffColumns)
      .from(staffUsers)
      .leftJoin(staffTeams, eq(staffTeams.id, staffUsers.teamId))
      .leftJoin(insurers, eq(insurers.id, staffUsers.insurerId))
      .where(insurerId ? eq(staffUsers.insurerId, insurerId) : undefined)
      .orderBy(asc(staffUsers.fullName), asc(staffUsers.id));
  }

  async findStaff(id: string, executor: Executor = this.db) {
    const [staff] = await executor
      .select(staffColumns)
      .from(staffUsers)
      .leftJoin(staffTeams, eq(staffTeams.id, staffUsers.teamId))
      .leftJoin(insurers, eq(insurers.id, staffUsers.insurerId))
      .where(eq(staffUsers.id, id));
    return staff;
  }

  async lockStaff(id: string, tx: Transaction) {
    const [staff] = await tx
      .select(staffColumns)
      .from(staffUsers)
      .leftJoin(staffTeams, eq(staffTeams.id, staffUsers.teamId))
      .leftJoin(insurers, eq(insurers.id, staffUsers.insurerId))
      .where(eq(staffUsers.id, id))
      .for('update', { of: staffUsers });
    return staff;
  }

  async insertStaff(
    tx: Transaction,
    staff: Pick<typeof staffUsers.$inferInsert, 'email' | 'fullName' | 'role' | 'insurerId' | 'teamId' | 'userId'>,
  ) {
    const [created] = await tx.insert(staffUsers).values(staff).returning({ id: staffUsers.id });
    return created;
  }

  async updateStaff(
    tx: Transaction,
    id: string,
    changes: Pick<typeof staffUsers.$inferInsert, 'role' | 'insurerId' | 'teamId' | 'isActive'>,
  ) {
    const [updated] = await tx
      .update(staffUsers)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(staffUsers.id, id))
      .returning({ id: staffUsers.id });
    return updated;
  }

  async revokeSessions(tx: Transaction, userId: string): Promise<void> {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
  }

  listTeams(insurerId?: string) {
    return this.db
      .select({ ...teamColumns, insurerName: insurers.name })
      .from(staffTeams)
      .innerJoin(insurers, eq(insurers.id, staffTeams.insurerId))
      .where(insurerId ? eq(staffTeams.insurerId, insurerId) : undefined)
      .orderBy(asc(insurers.name), asc(staffTeams.name), asc(staffTeams.id));
  }

  async findTeam(id: string, executor: Executor = this.db) {
    const [team] = await executor
      .select({ ...teamColumns, insurerName: insurers.name })
      .from(staffTeams)
      .innerJoin(insurers, eq(insurers.id, staffTeams.insurerId))
      .where(eq(staffTeams.id, id));
    return team;
  }

  async lockTeam(id: string, tx: Transaction) {
    const [team] = await tx
      .select({ ...teamColumns, insurerName: insurers.name })
      .from(staffTeams)
      .innerJoin(insurers, eq(insurers.id, staffTeams.insurerId))
      .where(eq(staffTeams.id, id))
      .for('update', { of: staffTeams });
    return team;
  }

  async insertTeam(tx: Transaction, team: Pick<typeof staffTeams.$inferInsert, 'insurerId' | 'name'>) {
    const [created] = await tx.insert(staffTeams).values(team).returning({ id: staffTeams.id });
    return created;
  }

  async renameTeam(tx: Transaction, id: string, name: string) {
    const [updated] = await tx
      .update(staffTeams)
      .set({ name, updatedAt: new Date() })
      .where(eq(staffTeams.id, id))
      .returning({ id: staffTeams.id });
    return updated;
  }

  async teamHasMembers(tx: Transaction, id: string): Promise<boolean> {
    const [member] = await tx.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.teamId, id)).limit(1);
    return member !== undefined;
  }

  async deleteTeam(tx: Transaction, id: string): Promise<void> {
    await tx.delete(staffTeams).where(eq(staffTeams.id, id));
  }

  async insurerExists(id: string, executor: Executor = this.db): Promise<boolean> {
    const [insurer] = await executor
      .select({ id: insurers.id })
      .from(insurers)
      .where(and(eq(insurers.id, id), ne(insurers.status, 'DELETED')));
    return insurer !== undefined;
  }

  async customerExistsForUser(tx: Transaction, userId: string): Promise<boolean> {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.userId, userId)).limit(1);
    return customer !== undefined;
  }

  async staffExistsForUser(tx: Transaction, userId: string): Promise<boolean> {
    const [staff] = await tx.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.userId, userId)).limit(1);
    return staff !== undefined;
  }

  async emailInUse(tx: Transaction, email: string): Promise<boolean> {
    const [user] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email)).limit(1);
    return user !== undefined;
  }
}
