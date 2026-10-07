import { PrismaClient, UserSession } from '@prisma/client';
import { AuthProvider, Platform, SessionStatus } from '@xyne/shared';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';
import { userActivityTrackingService } from './userActivityTrackingService';

/**
 * LEGACY `workflow.user_sessions` access. The table is read-only since the move to
 * `non_zero.auth_sessions` (src/auth/): no row is ever created or refreshed here any more.
 * The only writes left are status flips to REVOKED (account-wide revokes must also kill legacy
 * rows that were never converted) — see bypassAcl/authSessionServices.revokeAccountSessions.
 */

// Why a session ended — stored as the AUTH/LOGOUT activity event's label.
export type LogoutReason =
  | 'USER_LOGOUT'
  | 'DEVICE_REUSED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'PROVIDER_REVOKED'
  | 'ACCOUNT_LEFT'
  | 'TOKEN_EXPIRED'
  | 'EXPIRED'
  | 'TEST_CLEANUP';

// How the session was minted — stored as the AUTH/LOGIN activity event's
// label. A closed union so a typo'd method can't silently fragment the
// login-by-method breakdown.
export type LoginMethod =
  | AuthProvider
  | 'TEST'
  | 'WORKSPACE_CREATED' // already signed in — a session for a workspace they just created
  | 'WORKSPACE_JOINED' // already signed in — a session for a community workspace they just joined
  | 'WORKSPACE_SWITCHED' // already signed in — switched the active workspace on the same session
  | 'AUTO_LOGIN'; // reused an existing session to auto-log into a single workspace

// Legacy rows don't store a platform column; recover it from the deviceInfo JSON
// (explicit `platform` key first, then the user agent).
export function resolveSessionPlatform(deviceInfo?: string | null): Platform {
  let hint = '';
  let userAgent = '';
  if (deviceInfo) {
    try {
      const parsed = JSON.parse(deviceInfo) as { platform?: unknown; userAgent?: unknown };
      if (typeof parsed.platform === 'string') hint = parsed.platform.toLowerCase();
      if (typeof parsed.userAgent === 'string') userAgent = parsed.userAgent.toLowerCase();
    } catch {
      // deviceInfo is best-effort JSON
    }
  }
  if (hint === 'electron' || userAgent.includes('electron')) return Platform.ELECTRON;
  if (hint === 'mobile' || userAgent.includes('mobile')) return Platform.MOBILE;
  return Platform.WEB;
}

type SessionCandidate = Pick<UserSession, 'id' | 'userId' | 'deviceInfo' | 'createdAt'>;

export type LegacyPushRow = Pick<UserSession, 'id' | 'fcmToken' | 'voipToken' | 'deviceInfo'>;

export class UserSessionService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  // Public so callers that observe a session ending without themselves being
  // the one to end it can log it without touching the session row — this never
  // writes to UserSession, only to the activity log.
  trackLogout(session: SessionCandidate, reason: LogoutReason): void {
    void userActivityTrackingService.trackLogout(session.userId, {
      sessionId: session.id,
      reason,
      platform: resolveSessionPlatform(session.deviceInfo),
      metadata: {
        sessionDurationSec: Math.round((Date.now() - session.createdAt.getTime()) / 1000),
      },
    });
  }

  /**
   * Get a legacy session by ID (read-only).
   */
  async getSessionById(sessionId: string): Promise<(UserSession & { user: any }) | null> {
    try {
      return await this.prisma.userSession.findUnique({
        where: { id: sessionId },
        include: {
          user: {
            include: {
              orgMember: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Error getting session by ID:', error);
      throw new Error('Failed to get session by ID');
    }
  }

  /**
   * ACTIVE, unexpired legacy rows with a push token for every workspace user of the account.
   * Push delivery's legacy fallback until those rows are converted or expire.
   */
  async findLegacyPushRowsForAccount(accountId: string, now: Date = new Date()): Promise<LegacyPushRow[]> {
    return this.prisma.userSession.findMany({
      where: {
        status: SessionStatus.ACTIVE,
        refreshTokenExpiry: { gt: now },
        fcmToken: { not: null },
        user: { orgMemberId: accountId },
      },
      select: { id: true, fcmToken: true, voipToken: true, deviceInfo: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Revoke a specific legacy session (status only).
   */
  async revokeSession(sessionId: string, reason: LogoutReason): Promise<void> {
    try {
      // Read the status before flipping it, purely to decide whether this is
      // a logout worth logging (re-revoking an already-ended session is not).
      const previous = await this.prisma.userSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (!previous) return;

      const session = await this.prisma.userSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      if (previous.status === SessionStatus.ACTIVE) {
        this.trackLogout(session, reason);
      }

      logger.info(`Revoked legacy session`);
    } catch (error) {
      logger.error('Error revoking session:', error);
      throw new Error('Failed to revoke session');
    }
  }

  /**
   * Revoke all legacy sessions for a workspace user (status only).
   */
  async revokeAllUserSessions(userId: string, reason: LogoutReason): Promise<void> {
    try {
      // Read which sessions are live before the bulk update, purely to know
      // which ones to log a LOGOUT for.
      const liveSessions = await this.prisma.userSession.findMany({
        where: { userId, status: SessionStatus.ACTIVE },
        select: { id: true, userId: true, deviceInfo: true, createdAt: true },
      });
      if (liveSessions.length === 0) return;

      await this.prisma.userSession.updateMany({
        where: { userId, status: SessionStatus.ACTIVE },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      liveSessions.forEach((session) => this.trackLogout(session, reason));

      logger.info(`Revoked all legacy sessions for user: ${userId}`);
    } catch (error) {
      logger.error('Error revoking all user sessions:', error);
      throw new Error('Failed to revoke all user sessions');
    }
  }
}
