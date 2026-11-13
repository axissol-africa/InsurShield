import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { authSessions } from '../db/schema.js';
import {
  STAFF_SESSION_ABSOLUTE_LIFETIME_SECONDS,
  STAFF_SESSION_IDLE_LIFETIME_SECONDS,
} from './auth.constants.js';

type SessionRecord = Pick<typeof authSessions.$inferSelect, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

/** The reason a staff session is no longer usable, without exposing any session secret. */
export type StaffSessionExpiry = 'idle' | 'absolute' | null;

/** Server-side staff session windows, shared by protected API and identity endpoints. */
export function staffSessionExpiry(session: SessionRecord, now = Date.now()): StaffSessionExpiry {
  if (now >= session.createdAt.getTime() + STAFF_SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000) return 'absolute';
  if (now >= session.updatedAt.getTime() + STAFF_SESSION_IDLE_LIFETIME_SECONDS * 1000) return 'idle';
  return null;
}

/** Delete only the session being refused; other devices stay intact unless their own checks expire them. */
export async function revokeStaffSession(db: Database, session: SessionRecord): Promise<void> {
  await db
    .delete(authSessions)
    .where(and(eq(authSessions.id, session.id), eq(authSessions.userId, session.userId)));
}

/** Activity is recorded on the server because the session cookie itself is deliberately not refreshed. */
export async function touchStaffSession(db: Database, session: SessionRecord): Promise<void> {
  await db
    .update(authSessions)
    .set({ updatedAt: new Date() })
    .where(and(eq(authSessions.id, session.id), eq(authSessions.userId, session.userId)));
}
