// Thin HTTP boundary for the ticket-initiated Bitbucket PR flow.
//
// Responsibilities: authenticate the actor, parse params/body, delegate to
// TicketPullRequestService, and map typed service errors to HTTP responses.
// No provider calls or DB access happen here.

import { Request, Response } from 'express';
import { ticketPullRequestService } from '@/services/ticketPullRequestService';
import { resolveTicketPrFlags } from '@/services/ticketPrFeatureFlags';
import { TicketPullRequestError } from '@/types/ticketPullRequest';
import { logger } from '@/utils/logger';

export class TicketPullRequestController {
  /** Resolve { userId, workspaceId } or send 401 and return null. */
  private actor(req: Request, res: Response): { userId: string; workspaceId: string } | null {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: 'User not authenticated' });
      return null;
    }
    return { userId, workspaceId };
  }

  private fail(res: Response, error: unknown, context: string): void {
    if (error instanceof TicketPullRequestError) {
      res.status(error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }
    logger.error(`[TicketPR] ${context} failed:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }

  getFlags = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      const flags = await resolveTicketPrFlags({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
      });
      res.json({ flags });
    } catch (error) {
      this.fail(res, error, 'getFlags');
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      const pullRequests = await ticketPullRequestService.listPullRequestsForTicket(
        req.params.ticketId,
        actor,
      );
      res.json({ pullRequests });
    } catch (error) {
      this.fail(res, error, 'list');
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      const { repositoryUrl, sourceBranchName, destinationBranchName, title, description } =
        req.body ?? {};
      if (!repositoryUrl || !sourceBranchName || !destinationBranchName) {
        res.status(400).json({
          error: 'repositoryUrl, sourceBranchName and destinationBranchName are required',
        });
        return;
      }
      const pullRequest = await ticketPullRequestService.createPullRequestFromTicket(
        req.params.ticketId,
        { repositoryUrl, sourceBranchName, destinationBranchName, title, description },
        actor,
      );
      res.status(201).json({ pullRequest });
    } catch (error) {
      this.fail(res, error, 'create');
    }
  };

  link = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      const { pullRequestUrl } = req.body ?? {};
      if (!pullRequestUrl) {
        res.status(400).json({ error: 'pullRequestUrl is required' });
        return;
      }
      const pullRequest = await ticketPullRequestService.linkExistingPullRequest(
        req.params.ticketId,
        { pullRequestUrl },
        actor,
      );
      res.status(201).json({ pullRequest });
    } catch (error) {
      this.fail(res, error, 'link');
    }
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      const pullRequest = await ticketPullRequestService.refreshPullRequest(
        req.params.ticketId,
        req.params.pullRequestId,
        actor,
      );
      res.json({ pullRequest });
    } catch (error) {
      this.fail(res, error, 'refresh');
    }
  };

  unlink = async (req: Request, res: Response): Promise<void> => {
    const actor = this.actor(req, res);
    if (!actor) return;
    try {
      await ticketPullRequestService.unlinkPullRequest(
        req.params.ticketId,
        req.params.pullRequestId,
        actor,
      );
      res.status(204).send();
    } catch (error) {
      this.fail(res, error, 'unlink');
    }
  };
}
