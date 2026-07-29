import { PrismaClient, UserSession, SessionStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';

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
}

export interface UpdateSessionData {
  accessToken?: string;
  accessTokenExpiry?: Date;
  lastActivity?: Date;
  status?: SessionStatus;
  deviceId?: string;
  fcmToken?: string;
}

export class UserSessionService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
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
  async revokeSession(sessionId: string): Promise<void> {
    try {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      logger.info(`Revoked session`);
    } catch (error) {
      logger.error('Error revoking session:', error);
      throw new Error('Failed to revoke session');
    }
  }

  /**
   * Revoke session by refresh token
   */
  async revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
    try {
      await this.prisma.userSession.updateMany({
        where: { refreshToken },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

      logger.info(`Revoked session by refresh token`);
    } catch (error) {
      logger.error('Error revoking session by refresh token:', error);
      throw new Error('Failed to revoke session by refresh token');
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    try {
      await this.prisma.userSession.updateMany({
        where: { userId },
        data: {
          status: SessionStatus.REVOKED,
          updatedAt: new Date(),
        },
      });

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
