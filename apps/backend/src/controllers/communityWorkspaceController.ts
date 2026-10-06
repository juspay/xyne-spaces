import { Request, Response } from 'express';
import {
  CommunityJoinResultStatus,
  OrgRole,
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  AuthProvider,
} from '@xyne/shared';
import { communityWorkspaceService } from '@/services/communityWorkspaceService';
import { UserService } from '@/services/userService';
import type { LoginMethod } from '@/services/userSessionService';
import { channelService } from '@/services/channelService';
import { logger } from '@/utils/logger';
import { completeLogin } from '@/auth/loginCompletion';
import { readPendingAuth } from '@/auth/pendingAuth';
import { resolveRequest } from '@/auth/sessionResolver';
import { platformFromRequest } from '@/auth/platform';
import type { ExistingSessionRef } from '@/auth/types';

type PendingAuth = {
  userData: {
    providerUserId: string;
    email: string;
    name: string;
    picture?: string;
    authProvider: string;
  };
  /** Set when the caller was already signed in: the join adds a grant to that session. */
  existingSession: ExistingSessionRef | null;
  /** True when identity came from the pending-auth cookie (cleared after login completes). */
  pending: boolean;
};

export class CommunityWorkspaceController {
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

      // Already signed in ⇒ a grant on the existing session (WORKSPACE_JOINED); fresh
      // pending-auth identity ⇒ a new login under its provider. Cookies, the onboarding
      // cookie and the pending-cookie clear are all applied by completeLogin.
      await completeLogin({
        req,
        res,
        workspaceUser: joinResult.workspaceUser,
        loginMethod: pendingAuth.existingSession
          ? 'WORKSPACE_JOINED'
          : (pendingAuth.userData.authProvider.toUpperCase() as LoginMethod),
        platform: platformFromRequest(req),
        sameSite: 'strict',
        isNewUser: Boolean(joinResult.isNewUser),
        existingSession: pendingAuth.existingSession,
        pending: pendingAuth.pending,
      });

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

  /**
   * Identity for the join: the pending-auth cookie (fresh OAuth / email login, identity only)
   * first, else the caller's existing session via the shared resolver (auto-login / already
   * signed in). Nothing the resolver minted is written to the response here; completeLogin
   * issues the target workspace's cookies.
   */
  private async resolvePendingAuth(req: Request): Promise<PendingAuth | null> {
    const pending = readPendingAuth(req);
    if (pending) {
      const providerUserId = pending.providerUserId || pending.googleId;
      if (!providerUserId) return null;
      return {
        userData: {
          providerUserId,
          email: pending.email,
          name: pending.name,
          picture: pending.picture,
          authProvider: pending.provider || AuthProvider.GOOGLE,
        },
        existingSession: null,
        pending: true,
      };
    }

    const resolved = await resolveRequest(req, { allowBearer: false, allowAutoRefresh: true });
    if (!resolved.ok) return null;
    const { user, session, legacySession, legacySessionId } = resolved.auth;
    if (!user.googleId) return null;

    return {
      userData: {
        providerUserId: user.googleId,
        email: user.email,
        name: user.name || '',
        picture: legacySession?.user.picture || undefined,
        authProvider: user.authProvider || AuthProvider.GOOGLE,
      },
      existingSession: { sessionId: session?.id ?? null, legacySessionId },
      pending: false,
    };
  }
}

export const communityWorkspaceController = new CommunityWorkspaceController();
