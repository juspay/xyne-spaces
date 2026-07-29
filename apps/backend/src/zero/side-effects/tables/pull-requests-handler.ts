import { ActivityClassification, PRStatus } from '@prisma/client';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';
import { BaseSideEffectHandler } from '../base-handler';
import type {TableSchema } from '../../acl/core/types';
import type { SideEffectJobConfig } from '../types';
import { UpdateValue } from '@rocicorp/zero';

/**
 * Handler for creating PR-related activities for users
 * Note: PRs are updated via Prisma directly (not Zero) because the ACL blocks
 * all mutations on pull_requests table. Therefore, this handler is called manually
 * from backend services rather than through Zero mutators.
 */
export class PullRequestActivityHandler extends BaseSideEffectHandler {
  /**
   * Override onUpdate to create PR activities for relevant users when PR status changes via webhook
   * and triggers a ticket stage/status transition
   * 
   * Note: Called manually from backend services rather than through Zero mutators
   * because the ACL blocks all mutations on pull_requests table
   */
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const pullRequestId = job.entityId;
    const args:UpdateValue<TableSchema<'pull_requests'>> = job.args; 
    const actorId = this.ctx.userID
    if(!args?.status) {
      // No status change, no action needed
      return;
    }

    try {
      // Get the pull request details
      const pullRequest = await db.pullRequests.findUnique({
        where: { id: pullRequestId },
        select: {
          id: true,
          prId: true,
          prUrl: true,
          repoName: true,
          sourceBranchName: true,
          destinationBranchName: true,
          status: true,
          ticketId: true,
        },
      });

      if (!pullRequest) {
        logger.warn(`[PullRequestActivityHandler] Pull request ${pullRequestId} not found`);
        return;
      }

      // Use provided ticketId or fall back to PR's ticketId
      const targetTicketId = pullRequest.ticketId;

      // Only create activities if there's an associated ticket
      if (!targetTicketId) {
        logger.info(`[PullRequestActivityHandler] No ticket associated with PR ${pullRequest.prId}, skipping activity creation`);
        return;
      }

      // Fetch ticket details including users to notify
      const ticket = await db.ticket.findUnique({
        where: { id: targetTicketId },
        select: {
          id: true,
          xyneId: true,
          channelId: true,
          createdBy: true,
          assignedTo: true,
        },
      });

      if (!ticket) {
        logger.warn(`[PullRequestActivityHandler] Ticket ${targetTicketId} not found for PR ${pullRequest.prId}`);
        return;
      }

      // Determine users to notify (creator, assignee, excluding the actor)
      const usersToNotify = [
        ticket.createdBy,
        ticket.assignedTo,
      ].filter((userId, index, arr): userId is string =>
        Boolean(userId) && userId !== actorId && arr.indexOf(userId) === index
      );

      if (usersToNotify.length === 0) {
        logger.info(`[PullRequestActivityHandler] No users to notify for PR ${pullRequest.prId} status change`);
        return;
      }

      // Map PR event to actor action
      const actorAction = this.mapPREventToActorAction(args.status);

      logger.info(
        `[PullRequestActivityHandler] Creating PR activity: ${actorAction} for ticket ${ticket.xyneId}, ` +
        `PR ${pullRequest.prId}, users: ${usersToNotify.join(', ')}`
      );

      // Create activity for each user
      for (const userId of usersToNotify) {
        await activityService.createActivity({
          userId,
          actorAction,
          actionSource: 'ticket',
          actionSourceId: ticket.id,
          ticketId: ticket.id,
          channelId: ticket.channelId || undefined,
          pullRequestId: pullRequest.id,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        });
      }

      logger.info(
        `[PullRequestActivityHandler] Created PR activities for PR ${pullRequest.prId}, ` +
        `ticket ${ticket.id} for ${usersToNotify.length} users`
      );
    } catch (error) {
      logger.error(`[PullRequestActivityHandler] Failed to create PR activities:`, error);
      // Don't throw - we don't want to fail the main PR update
    }
  }

  /**
   * Map PR status event to activity actor action
   * @private
   */
  private mapPREventToActorAction(prEvent: PRStatus): string {
    const actionMap: Record<PRStatus, string> = {
      [PRStatus.OPEN]: 'ticket_pr_created',
      [PRStatus.UPDATED]: 'ticket_pr_updated',
      [PRStatus.MERGED]: 'ticket_pr_merged',
      [PRStatus.DECLINED]: 'ticket_pr_declined',
      [PRStatus.DELETED]: 'ticket_pr_deleted',
    };
    return actionMap[prEvent] || 'ticket_pr_updated';
  }
}
