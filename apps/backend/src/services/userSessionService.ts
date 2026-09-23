import { PrismaClient, UserSession } from '@prisma/client';
import { AuthProvider, Platform, SessionStatus } from '@xyne/shared';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';
import { userActivityTrackingService } from './userActivityTrackingService';

// Why a session ended — stored as the AUTH/LOGOUT activity event's label.
export type LogoutReason =
  | 'USER_LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'PROVIDER_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'TEST_CLEANUP';

// How the session was minted — stored as the AUTH/LOGIN activity event's
// label. A closed union so a typo'd method can't silently fragment the
// login-by-method breakdown.
export type LoginMethod =
  | AuthProvider
  | 'TEST'
  | 'WORKSPACE_CREATED' // already signed in — a session for a workspace they just created
  | 'WORKSPACE_JOINED' // already signed in — a session for a community workspace they just joined
  | 'AUTO_LOGIN'; // reused an existing session to auto-log into a single workspace

export interface CreateSessionData {
  userId: string;
  refreshToken: string;
  refreshTokenExpiry: Date;
  accessToken?: string;
  accessTokenExpiry?: Date;
  deviceInfo?: string;
  deviceId?: string;
  fcmToken?: string;
  ipAddress?: string;
  // Reported on the AUTH/LOGIN activity event; defaults to the user's authProvider.
  loginMethod?: LoginMethod;
}

export interface UpdateSessionData {
  accessToken?: string;
  accessTokenExpiry?: Date;
  lastActivity?: Date;
  status?: SessionStatus;
  deviceId?: string;
  fcmToken?: string;
}

// Sessions don't store a platform column; recover it from the deviceInfo JSON
// (explicit `platform` key first, then the user agent).
function resolveSessionPlatform(deviceInfo?: string | null): Platform {
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

export class UserSessionService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  // Public so callers that observe a session ending without themselves being
  // the one to end it (e.g. a denied refresh) can log it without touching the
  // session row — this never writes to UserSession, only to the activity log.
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
   * Create a new user session
   */
  async createSession(sessionData: CreateSessionData): Promise<UserSession> {
    const sessionCreateId = `SESSION_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const startTime = Date.now();
    
    try {
      logger.info(`🔍 [${sessionCreateId}] === Session Creation Started ===`);
      logger.info(`🔍 [${sessionCreateId}] UserId: ${sessionData.userId}`);
      logger.info(`🔍 [${sessionCreateId}] IP: ${sessionData.ipAddress}`);
      logger.info(`🔍 [${sessionCreateId}] Device: ${sessionData.deviceInfo?.substring(0, 100)}...`);
      
      // Check for existing active sessions first
      logger.info(`🔍 [${sessionCreateId}] 🔍 Checking existing active sessions...`);
      const existingActiveSessions = await this.prisma.userSession.count({
        where: {
          userId: sessionData.userId,
          status: SessionStatus.ACTIVE,
          refreshTokenExpiry: {
            gt: new Date()
          }
        }
      });
      logger.info(`🔍 [${sessionCreateId}] Found ${existingActiveSessions} existing active sessions`);
      
      logger.info(`🔍 [${sessionCreateId}] 💾 Creating session in database...`);
      const sessionUser = await this.prisma.user.findUnique({
        where: { id: sessionData.userId },
        select: { workspaceId: true },
      });
      if (!sessionUser) {
        throw new Error(`workspaceId required: user ${sessionData.userId} not found`);
      }
      const session = await this.prisma.userSession.create({
        data: {
          userId: sessionData.userId,
          workspaceId: sessionUser.workspaceId,
          refreshToken: sessionData.refreshToken,
          refreshTokenExpiry: sessionData.refreshTokenExpiry,
          accessToken: sessionData.accessToken,
          accessTokenExpiry: sessionData.accessTokenExpiry,
          deviceInfo: sessionData.deviceInfo,
          deviceId: sessionData.deviceId,
          fcmToken: sessionData.fcmToken,
          ipAddress: sessionData.ipAddress,
          status: SessionStatus.ACTIVE,
          lastActivity: new Date(),
        },
        include: {
          user: true,
        },
      });

      const endTime = Date.now();
      logger.info(`✅ [${sessionCreateId}] Session created successfully in ${endTime - startTime}ms`);
      logger.info(`✅ [${sessionCreateId}] === Session Creation Complete ===`);
      
      logger.info(`Created new session for user: ${session.userId}`);

      const loginMethod = sessionData.loginMethod ?? (session.user.authProvider as LoginMethod);
      void userActivityTrackingService.trackLogin(session.userId, {
        sessionId: session.id,
        method: loginMethod,
        platform: resolveSessionPlatform(session.deviceInfo),
        metadata: { authProvider: session.user.authProvider },
      });

      return session;
    } catch (error) {
      const endTime = Date.now();
      logger.info(`❌ [${sessionCreateId}] === Session Creation FAILED ===`);
      logger.info(`❌ [${sessionCreateId}] Error after ${endTime - startTime}ms:`, error);
      logger.info(`❌ [${sessionCreateId}] Error message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.info(`❌ [${sessionCreateId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      
      logger.error('Error creating user session:', error);
      throw new Error('Failed to create user session');
    }
  }

  /**
   * Get session by refresh token
   */
  async getSessionByRefreshToken(refreshToken: string): Promise<(UserSession & { user: any }) | null> {
    try {
      return await this.prisma.userSession.findUnique({
        where: {
          refreshToken,
          status: SessionStatus.ACTIVE,
        },
        include: {
          user: true,
        },
      });
    } catch (error) {
      logger.error('Error getting session by refresh token:', error);
      throw new Error('Failed to get session by refresh token');
    }
  }

  /**
   * Get session by ID
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
   * Get all active sessions for a user
   */
  async getActiveSessionsForUser(userId: string): Promise<UserSession[]> {
    try {
      return await this.prisma.userSession.findMany({
        where: {
          userId,
          status: SessionStatus.ACTIVE,
          refreshTokenExpiry: {
            gt: new Date(), // Only get non-expired sessions
          },
        },
        orderBy: {
          lastActivity: 'desc',
        },
      });
    } catch (error) {
      logger.error('Error getting active sessions for user:', error);
      throw new Error('Failed to get active sessions for user');
    }
  }

  /**
   * Update session data
   */
  async updateSession(sessionId: string, updateData: UpdateSessionData): Promise<UserSession> {
    try {
      const session = await this.prisma.userSession.update({
        where: { id: sessionId },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
        include: {
          user: true,
        },
      });

      logger.info(`Updated session`);
      return session;
    } catch (error) {
      logger.error('Error updating session:', error);
      throw new Error('Failed to update session');
    }
  }

  /**
   * Update session activity (touch session)
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: {
          lastActivity: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error updating session activity:', error);
      throw new Error('Failed to update session activity');
    }
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string, reason: LogoutReason): Promise<void> {
    try {
      // Read the status before flipping it, purely to decide whether this is
      // a logout worth logging (re-revoking an already-ended session is not).
      const previous = await this.prisma.userSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });

      const session = await this.prisma.userSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      if (previous?.status === SessionStatus.ACTIVE) {
        this.trackLogout(session, reason);
      }

      logger.info(`Revoked session`);
    } catch (error) {
      logger.error('Error revoking session:', error);
      throw new Error('Failed to revoke session');
    }
  }

  /**
   * Revoke session by refresh token
   */
  async revokeSessionByRefreshToken(refreshToken: string, reason: LogoutReason): Promise<void> {
    try {
      const liveSessions = await this.prisma.userSession.findMany({
        where: { refreshToken, status: SessionStatus.ACTIVE },
        select: { id: true, userId: true, deviceInfo: true, createdAt: true },
      });

      await this.prisma.userSession.updateMany({
        where: { refreshToken },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      liveSessions.forEach((session) => this.trackLogout(session, reason));

      logger.info(`Revoked session by refresh token`);
    } catch (error) {
      logger.error('Error revoking session by refresh token:', error);
      throw new Error('Failed to revoke session by refresh token');
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string, reason: LogoutReason): Promise<void> {
    try {
      // Read which sessions are live before the bulk update, purely to know
      // which ones to log a LOGOUT for.
      const liveSessions = await this.prisma.userSession.findMany({
        where: { userId, status: SessionStatus.ACTIVE },
        select: { id: true, userId: true, deviceInfo: true, createdAt: true },
      });

      await this.prisma.userSession.updateMany({
        where: { userId },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      liveSessions.forEach((session) => this.trackLogout(session, reason));

      logger.info(`Revoked all sessions for user: ${userId}`);
    } catch (error) {
      logger.error('Error revoking all user sessions:', error);
      throw new Error('Failed to revoke all user sessions');
    }
  }

  /**
   * Check if refresh token is valid and not expired
   */
  async isRefreshTokenValid(refreshToken: string): Promise<boolean> {
    try {
      const session = await this.prisma.userSession.findUnique({
        where: { refreshToken },
        select: {
          status: true,
          refreshTokenExpiry: true,
        },
      });

      if (!session) {
        return false;
      }

      const now = new Date();
      return session.status === SessionStatus.ACTIVE && session.refreshTokenExpiry > now;
    } catch (error) {
      logger.error('Error checking refresh token validity:', error);
      return false;
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await this.prisma.userSession.updateMany({
        where: {
          refreshTokenExpiry: {
            lt: new Date(),
          },
          status: SessionStatus.ACTIVE,
        },
        data: {
          status: SessionStatus.EXPIRED,
          updatedAt: new Date(),
        },
      });

      logger.info(`Marked ${result.count} expired sessions`);
      return result.count;
    } catch (error) {
      logger.error('Error cleaning up expired sessions:', error);
      throw new Error('Failed to clean up expired sessions');
    }
  }

  /**
   * Get session statistics for a user
   */
  async getUserSessionStats(userId: string) {
    try {
      const stats = await this.prisma.userSession.groupBy({
        by: ['status'],
        where: { userId },
        _count: {
          status: true,
        },
      });

      const totalSessions = await this.prisma.userSession.count({
        where: { userId },
      });

      const lastActivity = await this.prisma.userSession.findFirst({
        where: { userId },
        orderBy: { lastActivity: 'desc' },
        select: { lastActivity: true },
      });

      return {
        totalSessions,
        statusDistribution: stats.reduce((acc, stat) => {
          acc[stat.status] = stat._count.status;
          return acc;
        }, {} as Record<string, number>),
        lastActivity: lastActivity?.lastActivity,
      };
    } catch (error) {
      logger.error('Error getting user session stats:', error);
      throw new Error('Failed to get user session statistics');
    }
  }

  /**
   * Clean up - close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
