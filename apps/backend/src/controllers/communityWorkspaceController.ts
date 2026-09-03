import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  CommunityJoinResultStatus,
  OrgRole,
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  AuthProvider,
} from '@xyne/shared';
import { communityWorkspaceService } from '@/services/communityWorkspaceService';
import { UserSessionService } from '@/services/userSessionService';
import { UserService } from '@/services/userService';
import { jwtService } from '@/services/jwtService';
import { channelService } from '@/services/channelService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { setOnboardingCookie } from '@/utils/onboardingCookie';

type PendingAuth = {
  userData: {
    providerUserId: string;
    email: string;
    name: string;
    picture?: string;
    authProvider: string;
  };
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiry?: Date;
  tokenKey?: string;
};

export class CommunityWorkspaceController {
  private userSessionService = new UserSessionService();
  private userService = new UserService();

  listCommunityWorkspaces = async (_req: Request, res: Response): Promise<void> => {
    try {
      const organizations = await communityWorkspaceService.listCommunityWorkspaces();
      res.status(200).json({ organizations });
    } catch (error) {
      logger.error('[CommunityWorkspaceController] Failed to list community workspaces:', error);
      res.status(500).json({
        error: 'Failed to list community workspaces',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  joinCommunityWorkspace = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;
      const { channelId, workspaceType } = req.body as { channelId?: string; workspaceType?: string };

      if (!workspaceId) {
        res
          .status(400)
          .json({ error: 'Missing required fields', message: 'workspaceId is required' });
        return;
      }

      const pendingAuth = await this.resolvePendingAuth(req);
      if (!pendingAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Login is required before joining a community workspace',
        });
        return;
      }

      const joinResult = await communityWorkspaceService.joinCommunityWorkspace({
        workspaceId,
        channelId,
        workspaceType,
        userData: pendingAuth.userData,
      });

      if (joinResult.status !== CommunityJoinResultStatus.JOINED) {
        res.status(202).json({
          success: true,
          status: joinResult.status,
          workspaceId,
          joinRequest: joinResult.joinRequest,
        });
        return;
      }

      if (!joinResult.workspaceUser) {
        res.status(500).json({ error: 'Failed to join community workspace' });
        return;
      }

      await this.userService.ensureUserPresence(joinResult.workspaceUser.id, joinResult.workspaceUser.workspaceId);
      const selfDmChannelId = await channelService.ensureSelfDmExists(
        joinResult.workspaceUser.id,
        joinResult.workspaceUser.workspaceId
      );

      const sessionId = await this.createSessionIfPossible(
        req,
        joinResult.workspaceUser.id,
        pendingAuth
      );
      const token = jwtService.generateToken({
        sub: joinResult.workspaceUser.id,
        email: joinResult.workspaceUser.email,
        name: joinResult.workspaceUser.name,
        picture: joinResult.workspaceUser.picture || undefined,
        workspaceId: joinResult.workspaceUser.workspaceId ?? undefined,
        memberId: joinResult.workspaceUser.orgMemberId,
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      res.cookie(`xyne_ws_${workspaceId}_token`, token, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });
      res.cookie('xyne_last_workspace', workspaceId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }
      setOnboardingCookie(res, Boolean(joinResult.isNewUser), {
        secure: isProduction,
        sameSite: 'strict' as const,
      });
      if (pendingAuth.tokenKey) {
        await redisService.del(
          `${config.pendingOAuthTokens.redisKeyPrefix}${pendingAuth.tokenKey}`,
        );
      }
      res.clearCookie('google_access_token', { path: '/' });

      res.status(200).json({
        success: true,
        status: joinResult.status,
        workspaceId,
        landingChannelId: joinResult.landingChannelId,
        selfDmChannelId,
        isNewUser: joinResult.isNewUser,
        user: {
          id: joinResult.workspaceUser.id,
          googleId: joinResult.workspaceUser.providerUserId,
          email: joinResult.workspaceUser.email,
          name: joinResult.workspaceUser.name,
          picture: joinResult.workspaceUser.picture,
          workspaceId: joinResult.workspaceUser.workspaceId,
          role: joinResult.workspaceUser.role,
          orgRole: OrgRole.COMMUNITY_MEMBER,
          memberId: joinResult.workspaceUser.orgMemberId,
        },
      });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
      logger.error('[CommunityWorkspaceController] Failed to join community workspace:', error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Failed to join community workspace' : 'Community join failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  listOrgJoinRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const reviewerUserId = req.user?.id;

      if (!orgId) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'orgId is required',
        });
        return;
      }

      if (!reviewerUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const requests = await communityWorkspaceService.listOrgJoinRequests({
        orgId,
        reviewerUserId,
        status,
      });

      res.status(200).json({ success: true, requests });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
      logger.error('[CommunityWorkspaceController] Failed to list organization join requests:', error);
      res.status(statusCode).json({
        error:
          statusCode >= 500 ? 'Failed to list organization join requests' : 'Join request lookup failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  reviewJoinRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, requestId } = req.params;
      const { action, reviewNote } = req.body as {
        action?: WorkspaceJoinRequestActionType;
        reviewNote?: string;
      };
      const reviewerUserId = req.user?.id;

      if (!workspaceId || !requestId) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'workspaceId and requestId are required',
        });
        return;
      }

      if (!reviewerUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!action || !Object.values(WorkspaceJoinRequestAction).includes(action)) {
        res.status(400).json({
          error: 'Invalid action',
          message: 'action must be APPROVE or REJECT',
        });
        return;
      }

      const request = await communityWorkspaceService.reviewJoinRequest({
        workspaceId,
        requestId,
        reviewerUserId,
        action,
        reviewNote,
      });

      res.status(200).json({
        success: true,
        status: request.status,
        request,
        approved: request.status === WorkspaceJoinRequestStatus.APPROVED,
      });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
      logger.error('[CommunityWorkspaceController] Failed to review join request:', error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Failed to review join request' : 'Join request review failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  private async resolvePendingAuth(req: Request): Promise<PendingAuth | null> {
    const pendingAuthCookie = req.cookies?.google_access_token;
    if (pendingAuthCookie) {
      return this.parsePendingAuthCookie(pendingAuthCookie);
    }

    const sessionId = req.cookies?.user_session_id;
    if (!sessionId) return null;

    const session = await this.userSessionService.getSessionById(sessionId);
    if (
      !session ||
      !session.user ||
      session.status !== 'ACTIVE' ||
      new Date() > session.refreshTokenExpiry
    ) {
      return null;
    }

    return {
      userData: {
        providerUserId: session.user.providerUserId,
        email: session.user.email,
        name: session.user.name || '',
        picture: session.user.picture || undefined,
        authProvider: session.user.authProvider || AuthProvider.GOOGLE,
      },
      refreshToken: session.refreshToken,
      accessToken: session.accessToken || undefined,
      accessTokenExpiry: session.accessTokenExpiry || undefined,
    };
  }

  private async parsePendingAuthCookie(cookie: string): Promise<PendingAuth | null> {
    try {
      const decoded = jwt.verify(cookie, process.env.JWT_SECRET!) as {
        googleId?: string;
        providerUserId?: string;
        email?: string;
        name?: string;
        picture?: string;
        provider?: string;
        refreshToken?: string | null;
        accessToken?: string | null;
        accessTokenExpiry?: string | null;
        tokenKey?: string;
      };
      const providerUserId = decoded.providerUserId || decoded.googleId;
      if (!decoded.email || !providerUserId) return null;

      let redisTokens: {
        refreshToken?: string | null;
        accessToken?: string | null;
        accessTokenExpiry?: string | null;
      } | null = null;

      if (decoded.tokenKey) {
        const storedTokens = await redisService.get(
          `${config.pendingOAuthTokens.redisKeyPrefix}${decoded.tokenKey}`,
        );
        if (!storedTokens) return null;
        redisTokens = JSON.parse(storedTokens);
      }

      const refreshToken = redisTokens?.refreshToken ?? decoded.refreshToken;
      const accessToken = redisTokens?.accessToken ?? decoded.accessToken;
      const accessTokenExpiryValue =
        redisTokens?.accessTokenExpiry ?? decoded.accessTokenExpiry;
      const accessTokenExpiry = accessTokenExpiryValue
        ? new Date(accessTokenExpiryValue)
        : undefined;
      return {
        userData: {
          providerUserId,
          email: decoded.email,
          name: decoded.name || '',
          picture: decoded.picture,
          authProvider: decoded.provider || AuthProvider.GOOGLE,
        },
        refreshToken: refreshToken || undefined,
        accessToken: accessToken || undefined,
        accessTokenExpiry:
          accessTokenExpiry && !Number.isNaN(accessTokenExpiry.getTime())
            ? accessTokenExpiry
            : undefined,
        tokenKey: decoded.tokenKey,
      };
    } catch (_error) {
      return null;
    }
  }

  private async createSessionIfPossible(
    req: Request,
    userId: string,
    pendingAuth: PendingAuth
  ): Promise<string | null> {
    if (!pendingAuth.refreshToken) return null;

    try {
      const refreshTokenExpiry = new Date();
      refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

      const session = await this.userSessionService.createSession({
        userId,
        refreshToken: pendingAuth.refreshToken,
        refreshTokenExpiry,
        accessToken: pendingAuth.accessToken,
        accessTokenExpiry: pendingAuth.accessTokenExpiry,
        deviceInfo: JSON.stringify({
          userAgent: req.headers['user-agent'],
          acceptLanguage: req.headers['accept-language'],
          timestamp: new Date().toISOString(),
          appVersion: req.headers['x-app-version'],
        }),
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
      });

      return session.id;
    } catch (error) {
      logger.error('[CommunityWorkspaceController] Session creation failed:', error);
      return null;
    }
  }
}

export const communityWorkspaceController = new CommunityWorkspaceController();
