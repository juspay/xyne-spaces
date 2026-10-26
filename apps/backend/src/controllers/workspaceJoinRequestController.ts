import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
} from '@xyne/shared';
import { workspaceJoinRequestService } from '@/services/workspaceJoinRequestService';
import { UserSessionService } from '@/services/userSessionService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export class WorkspaceJoinRequestController {
  private userSessionService = new UserSessionService();

  requestJoin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.params;

      if (!workspaceId) {
        res
          .status(400)
          .json({ error: 'Missing required fields', message: 'workspaceId is required' });
        return;
      }

      const email = await this.resolveRequesterEmail(req);
      if (!email) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Login is required before requesting to join a workspace',
        });
        return;
      }

      const joinRequest = await workspaceJoinRequestService.requestJoin({ workspaceId, email });

      res.status(202).json({
        success: true,
        status: joinRequest.status,
        workspaceId,
        joinRequest,
      });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
      logger.error('[WorkspaceJoinRequestController] Failed to request workspace join:', error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Failed to request workspace join' : 'Workspace join request failed',
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

      const requests = await workspaceJoinRequestService.listOrgJoinRequests({
        orgId,
        reviewerUserId,
        status,
      });

      res.status(200).json({ success: true, requests });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
      logger.error('[WorkspaceJoinRequestController] Failed to list organization join requests:', error);
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

      const request = await workspaceJoinRequestService.reviewJoinRequest({
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
      logger.error('[WorkspaceJoinRequestController] Failed to review join request:', error);
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Failed to review join request' : 'Join request review failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  private async resolveRequesterEmail(req: Request): Promise<string | null> {
    const pendingAuthCookie = req.cookies?.google_access_token;
    if (pendingAuthCookie) {
      try {
        const decoded = jwt.verify(pendingAuthCookie, config.jwt.secret) as { email?: string };
        return decoded.email || null;
      } catch (_error) {
        return null;
      }
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

    return session.user.email;
  }
}

export const workspaceJoinRequestController = new WorkspaceJoinRequestController();
