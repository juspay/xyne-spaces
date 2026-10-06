/**
 * ACL-wrapped self-service over `auth_sessions`: a signed-in principal reading / ending its
 * own account sessions. Reads go through the shared `db` client (AuthSessionsACL scopes to
 * `ctx.memberId`); the cascade itself is the bypass-ACL revocation so grants, legacy rows and
 * the Redis tombstone stay in step.
 */
import type { AuthSession } from '@prisma/client';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { revokeSessionCascade, touchSession } from '@/bypassAcl/authSessionServices';
import type { AuthSessionWithGrants } from './types';

/** Minimum gap between two `lastSeenAt` / `lastActivity` writes for one session. */
export const TOUCH_THROTTLE_MS = 60_000;

export function shouldTouch(lastSeenAt: Date | null | undefined, now: Date): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_THROTTLE_MS;
}

export interface DecodedDeviceInfo {
  userAgent?: string;
  acceptLanguage?: string;
  timestamp?: string;
  platform?: string;
  appVersion?: string;
  [key: string]: unknown;
}

export class AuthSessionService {
  /** The caller's own session (ACL: accountId = ctx.memberId), grants included. */
  getById(sessionId: string): Promise<AuthSessionWithGrants | null> {
    return db.authSession.findFirst({ where: { id: sessionId }, include: { grants: true } });
  }

  /** The caller's ACTIVE sessions, newest activity first. */
  listActive(): Promise<AuthSessionWithGrants[]> {
    return db.authSession.findMany({
      where: { status: 'ACTIVE' },
      include: { grants: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Throttled (`TOUCH_THROTTLE_MS`) `lastSeenAt` + legacy `lastActivity` bump. */
  async touchLastSeen(session: AuthSessionWithGrants, now: Date = new Date()): Promise<boolean> {
    if (!shouldTouch(session.lastSeenAt, now)) return false;
    const legacyIds = new Set<string>();
    if (session.legacySessionId) legacyIds.add(session.legacySessionId);
    for (const g of session.grants) if (g.legacySessionId) legacyIds.add(g.legacySessionId);
    await touchSession(session.id, [...legacyIds], now);
    return true;
  }

  /** Ends one of the caller's own sessions: grants, legacy rows and Redis tombstone included. */
  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const own = await this.getById(sessionId);
    if (!own) {
      logger.warn('[AUTH] [AuthSessionService] revoke refused: session not owned by caller', { sessionId });
      return false;
    }
    await revokeSessionCascade(own.id, reason);
    return true;
  }

  decryptDeviceInfo(session: Pick<AuthSession, 'deviceInfo'>): DecodedDeviceInfo | null {
    if (!session.deviceInfo) return null;
    try {
      const parsed = JSON.parse(decrypt(session.deviceInfo)) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as DecodedDeviceInfo) : null;
    } catch (error) {
      logger.warn('[AUTH] [AuthSessionService] deviceInfo decrypt failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  decryptIpAddress(session: Pick<AuthSession, 'ipAddress'>): string | null {
    if (!session.ipAddress) return null;
    try {
      return decrypt(session.ipAddress);
    } catch {
      return null;
    }
  }
}

export const authSessionService = new AuthSessionService();
