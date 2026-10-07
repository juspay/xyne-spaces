import { Request, Response } from 'express';
import {
  CommunityJoinResultStatus,
  OrgRole,
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  AuthProvider,
} from '@xyne/shared';
import { communityWorkspaceService, type CommunityJoinUserData } from '@/services/communityWorkspaceService';
import { UserService } from '@/services/userService';
import { channelService } from '@/services/channelService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { completeLogin } from '@/auth/loginCompletion';
import { readPendingAuth } from '@/auth/pendingAuth';
import { platformFromRequest } from '@/auth/platform';
import { resolveSessionFromRequest } from '@/auth/sessionResolver';
import { findOrgMember } from '@/bypassAcl/authSessionServices';

export class CommunityWorkspaceController {
  private userService = new UserService();
  private prisma = DatabaseClient.getInstance();

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

      const userData = await this.resolveJoinIdentity(req);
      if (!userData) {
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
        userData,
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

      const orgMember = await findOrgMember(joinResult.workspaceUser.orgMemberId);
      if (!orgMember || orgMember.leftAt) {
        res.status(500).json({ error: 'Failed to join community workspace' });
        return;
      }

      // Reuses the caller's device session when one is present (already signed in elsewhere),
      // otherwise issues one; writes the workspace hint and clears the pending identity cookie.
      const platform = platformFromRequest(req);
      const login = await completeLogin({
        req,
        res,
        workspaceUser: joinResult.workspaceUser,
        orgMember: { memberId: orgMember.memberId, orgId: orgMember.orgId, role: orgMember.role },
        platform,
        loginMethod: 'WORKSPACE_JOINED',
        sameSite: platform === 'mobile' ? 'none' : 'strict',
        isNewUser: Boolean(joinResult.isNewUser),
        clearPending: true,
      });

      res.status(200).json({
        success: true,
        status: joinResult.status,
        workspaceId,
        landingChannelId: joinResult.landingChannelId,
        selfDmChannelId,
        isNewUser: joinResult.isNewUser,
        ...(platform !== 'web' ? { sessionId: login.sessionToken, token: login.token } : {}),
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
   * Who is joining: the pending (pre-workspace) identity cookie from a fresh login, else the
   * caller's live device session — any ACTIVE membership of that account carries the identity
   * (email / provider subject are the same in every workspace of the account).
   */
  private async resolveJoinIdentity(req: Request): Promise<CommunityJoinUserData | null> {
    const pending = readPendingAuth(req);
    if (pending) {
      if (!pending.providerUserId) return null;
      return {
        providerUserId: pending.providerUserId,
        email: pending.email,
        name: pending.name,
        picture: pending.picture,
        authProvider: pending.provider || AuthProvider.GOOGLE,
      };
    }

    const resolved = await resolveSessionFromRequest(req);
    if (!resolved.ok) return null;

    const membership = await this.prisma.user.findFirst({
      where: { orgMemberId: resolved.session.session.accountId, status: 'ACTIVE', leftAt: null },
      orderBy: { createdAt: 'desc' },
      select: { providerUserId: true, email: true, name: true, picture: true, authProvider: true },
    });
    if (!membership) return null;

    return {
      providerUserId: membership.providerUserId,
      email: membership.email,
      name: membership.name || '',
      picture: membership.picture || undefined,
      authProvider: membership.authProvider || AuthProvider.GOOGLE,
    };
  }
}

export const communityWorkspaceController = new CommunityWorkspaceController();
