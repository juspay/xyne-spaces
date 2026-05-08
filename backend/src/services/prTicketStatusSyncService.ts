// PR to Ticket Status Sync Service
// Handles mapping PR status changes to ticket stage updates based on configurable PR status mappings

import { PRStatus, TicketStatusV2, PRStatusEvent, MessageType, ActivityType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { ticketService } from '@/services/ticketService';
import { ActivitySource } from '@/types/ticket';
import { logger } from '@/utils/logger';
import { UserRepository } from '@/database/repositories/users';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { v4 as uuidv4 } from 'uuid';
import { PullRequestActivityHandler } from '@/zero/side-effects/tables/pull-requests-handler';
import { TicketAssignmentsSideEffectHandler } from '@/zero/side-effects/tables/ticket-assignments-handler';
import { db } from '@/database/client';

const prisma = DatabaseClient.getInstance();

/**
 * Human-readable PR action text enum
 */
enum PRActionText {
  RAISED = 'raised',
  UPDATED = 'updated',
  MERGED = 'merged',
  DECLINED = 'declined',
  DELETED = 'deleted',
}

interface PRStatusUpdateParams {
  prId: number;
  prUrl: string;
  newStatus: PRStatus;
  prEvent: PRStatusEvent;
  stageEvent?: PRStatusEvent;
  prAuthor?: string;
  prAuthorEmail?: string;
  remainingOpenPRs?: number;
}

interface TicketInfo {
  id: string;
  xyneId: string;
  statusV2: TicketStatusV2;
  stageName: string | null;
  conversationId: string | null;
  boardId: string;
  userGroupId: string | null;
  channelId: string | null;
  assignedTo: string | null;
  workspaceId: string;
}

interface StageInfo {
  id: string;
  name: string;
}

interface PRInfo {
  id: string;
  prId: number;
  prUrl: string;
  status: PRStatus;
  ticketId: string | null;
  workflowExecutionId: string | null;
  repoName: string;
  sourceBranchName: string;
  destinationBranchName: string;
}

export class PRTicketStatusSyncService {
  private readonly userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
  }
  /**
   * Look up user by email and return user ID, or Bitbucket bot ID if not found
   */
  private async resolveUpdatedBy(email: string | undefined, workspaceId: string): Promise<string> {
    if (!email) {
      return await this.getBitbucketBotId(workspaceId);
    }

    try {
      const user = await this.userRepository.findByEmail(email, workspaceId);
      if (user) {
        return user.id;
      }

      return await this.getBitbucketBotId(workspaceId);
    } catch (error) {
      logger.error(`[PR-Ticket-Sync] Error looking up user by email ${email}:`, error);
      return await this.getBitbucketBotId(workspaceId);
    }
  }

  /**
   * Get the Bitbucket bot user ID
   * Falls back to xyne-automatic bot if Bitbucket bot is not found
   */
  private async getBitbucketBotId(workspaceId: string): Promise<string> {
    try {
      const bitbucketBot = await unifiedBotUserService.getBotByEmail('bitbucket-bot@bot.xyne.ai', workspaceId);
      if (bitbucketBot) {
        return bitbucketBot.id;
      }

      logger.warn('[PR-Ticket-Sync] Bitbucket bot not found, falling back to xyne-automatic bot');
      const xyneBot = await unifiedBotUserService.getBotByEmail('ticket-bot@bot.xyne.ai', workspaceId);
      if (xyneBot) {
        return xyneBot.id;
      }

      logger.error('[PR-Ticket-Sync] No bot found, using fallback ID');
      return 'BOT';
    } catch (error) {
      logger.error('[PR-Ticket-Sync] Error getting Bitbucket bot ID:', error);
      return 'BOT';
    }
  }

  /**
   * Fetch complete QueryContext for a user by ID.
   * Used by side-effect handlers that need workspaceId, role, and memberId.
   */
  private async fetchUserContext(userId: string): Promise<{ userID: string; workspaceId: string; role: string; memberId: string; orgRole: string }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, workspaceId: true, role: true },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (!user.workspaceId) {
      throw new Error(`User ${userId} has no workspace assigned`);
    }

    // Email is globally unique in orgMember, single lookup is sufficient
    const orgMember = await db.orgMember.findUnique({
      where: { email: user.email },
    });

    if (!orgMember) {
      throw new Error(`User ${userId} is not a member of any organization`);
    }

    return {
      userID: user.id,
      workspaceId: user.workspaceId,
      orgRole: orgMember.role,
      role: user.role,
      memberId: orgMember.memberId,
    };
  }

  /**
   * Find the stage that has this PR status event mapped
   * Queries stages in the board and finds one with a matching PR status mapping
   */
  private async findStageForPRStatus(
    boardId: string,
    prStatusEvent: PRStatusEvent
  ): Promise<StageInfo | null> {
    try {
      // Find all stages in the board
      const stages = await prisma.stage.findMany({
        where: {
          boardId: boardId,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (stages.length === 0) {
        return null;
      }

      // Find all mappings for this PR status event
      const mappings = await prisma.stagePRStatusMapping.findMany({
        where: {
          prStatus: prStatusEvent,
        },
        select: {
          stageId: true,
        },
      });

      if (mappings.length === 0) {
        return null;
      }

      // Extract stageIds from mappings
      const mappedStageIds = new Set(mappings.map(m => m.stageId));

      // Find the stage in this board that has the mapping
      const stage = stages.find(s => mappedStageIds.has(s.id));

      if (!stage) {
        return null;
      }

      return stage;
    } catch (error) {
      logger.error(`[PR-Ticket-Sync] Error finding stage for PR status ${prStatusEvent}:`, error);
      return null;
    }
  }

  /**
   * Synchronize ticket stage based on PR status change
   * Uses configurable stage-based PR status mappings from the database
   *
   * @param params - PR update parameters
   */
  async syncTicketStatusOnPRChange(params: PRStatusUpdateParams): Promise<void> {
    try {
      logger.info(
        `[PR-Ticket-Sync] Starting sync for PR ${params.prId} with event: ${params.prEvent}`
      );

      // 1. Get the PR record from database
      const pr = await this.findPR(params.prId, params.prUrl);
      if (!pr) {
        logger.warn(`[PR-Ticket-Sync] PR not found: ${params.prId}`);
        return;
      }

      // 2. Find the associated ticket
      const ticket = await this.findTicketForPR(pr);
      if (!ticket) {
        logger.warn(`[PR-Ticket-Sync] No ticket found for PR ${params.prId}`);
        return;
      }

      // 3. Resolve the user who triggered the update
      const updatedBy = await this.resolveUpdatedBy(params.prAuthorEmail, ticket.workspaceId);

      // 4. Find stage with this PR status mapped
      const targetStage = await this.findStageForPRStatus(ticket.boardId, params.stageEvent ?? params.prEvent);
      if (!targetStage) {
        logger.debug(
          `[PR-Ticket-Sync] No stage mapped for PR status: ${params.prEvent} in board ${ticket.boardId}, logging activity only`
        );
        // Create PR activity without stage change using the repository
        await ticketService.updateTicketStageForWorkflow(
          ticket.id,
          updatedBy,
          ticket.stageName || 'Unknown', // Keep current stage
          ActivitySource.WEBHOOK,
          {
            prEvent: params.prEvent,
            prId: pr.prId,
            prUrl: pr.prUrl,
            repoName: pr.repoName,
            sourceBranchName: pr.sourceBranchName,
            destinationBranchName: pr.destinationBranchName,
            prAuthor: params.prAuthor,
            remainingOpenPRs: params.remainingOpenPRs,
            pullRequestId: pr.id,
          }
        );
        await this.sendTicketUpdateMessage(ticket, pr, params, updatedBy);
        return;
      }

      // 5. Check if we should skip update due to remaining open PRs
      const shouldSkipUpdate = this.shouldSkipUpdate(params);
      if (shouldSkipUpdate) {
        logger.debug(
          `[PR-Ticket-Sync] Skipping stage update: ${params.remainingOpenPRs} open PRs remaining for ticket ${ticket.xyneId}`
        );
        // Create PR activity without stage change
        await ticketService.updateTicketStageForWorkflow(
          ticket.id,
          updatedBy,
          ticket.stageName || 'Unknown', // Keep current stage
          ActivitySource.WEBHOOK,
          {
            prEvent: params.prEvent,
            prId: pr.prId,
            prUrl: pr.prUrl,
            repoName: pr.repoName,
            sourceBranchName: pr.sourceBranchName,
            destinationBranchName: pr.destinationBranchName,
            prAuthor: params.prAuthor,
            remainingOpenPRs: params.remainingOpenPRs,
            pullRequestId: pr.id,
          }
        );
        await this.sendTicketUpdateMessage(
          ticket,
          pr,
          params,
          updatedBy,
          undefined,
          params.remainingOpenPRs
        );
        return;
      }

      // 6. Update ticket stage with PR activity (all in one place via repository)
      const oldStageName = ticket.stageName;
      const stageChanged = targetStage.name !== oldStageName;

      // Call ticketService which validates and calls repository with all data
      await ticketService.updateTicketStageForWorkflow(
        ticket.id,
        updatedBy,
        targetStage.name,
        ActivitySource.WEBHOOK,
        {
          prEvent: params.prEvent,
          prId: pr.prId,
          prUrl: pr.prUrl,
          repoName: pr.repoName,
          sourceBranchName: pr.sourceBranchName,
          destinationBranchName: pr.destinationBranchName,
          prAuthor: params.prAuthor,
          remainingOpenPRs: params.remainingOpenPRs,
          pullRequestId: pr.id,
        }
      );

      if (stageChanged) {
        logger.info(
          `[PR-Ticket-Sync] Updated ticket ${ticket.xyneId} stage: ${oldStageName} → ${targetStage.name}`
        );
        
        // Create PR activities for users when stage changed due to PR webhook
        const userContext = await this.fetchUserContext(updatedBy);
        const prActivityHandler = new PullRequestActivityHandler(userContext);
        await prActivityHandler.onUpdate({
          entityType: 'pull_requests',
          entityId: pr.id,
          operation: 'update',
          args: {
            status: params.newStatus,
          },
        });
      } else {
        logger.debug(`[PR-Ticket-Sync] Ticket ${ticket.xyneId} already in stage ${targetStage.name}`);
      }

      // 8. Auto-assign PR_REVIEWER or QA based on PR event
      await this.handleAssignmentBasedOnPREvent(ticket, params.prEvent, updatedBy, params.stageEvent);

      // 9. Send message to conversation
      const stageChange = stageChanged
        ? { oldStageName, newStageName: targetStage.name }
        : undefined;
      await this.sendTicketUpdateMessage(ticket, pr, params, updatedBy, stageChange);
    } catch (error) {
      logger.error(`[PR-Ticket-Sync] Failed to sync ticket for PR ${params.prId}:`, error);
      // Don't throw - webhook processing should continue even if sync fails
    }
  }

  /**
   * Check if we should skip the stage update
   */
  private shouldSkipUpdate(params: PRStatusUpdateParams): boolean {
    const remainingOpenPRs = params.remainingOpenPRs ?? 0;
    return (
      (params.prEvent === PRStatusEvent.MERGED ||
        params.prEvent === PRStatusEvent.DELETED ||
        params.prEvent === PRStatusEvent.DECLINED) &&
      remainingOpenPRs > 0
    );
  }

  /**
   * Find PR record from database
   */
  private async findPR(prId: number, prUrl: string): Promise<PRInfo | null> {
    return await prisma.pullRequests.findFirst({
      where: { prId, prUrl },
      select: {
        id: true,
        prId: true,
        prUrl: true,
        status: true,
        ticketId: true,
        workflowExecutionId: true,
        repoName: true,
        sourceBranchName: true,
        destinationBranchName: true,
      },
    });
  }

  /**
   * Find the associated ticket for a PR
   * Priority: ticketId (direct) → workflowExecutionId → Workflow → ticketId
   * Backfills ticketId when found via workflow chain for faster future lookups
   */
  private async findTicketForPR(pr: PRInfo): Promise<TicketInfo | null> {
    // First try direct ticketId
    if (pr.ticketId) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: pr.ticketId },
        select: {
          id: true,
          xyneId: true,
          statusV2: true,
          stageName: true,
          conversationId: true,
          boardId: true,
          userGroupId: true,
          channelId: true,
          assignedTo: true,
          workspaceId: true,
        },
      });
      if (ticket) {
        logger.info(`[PR-Ticket-Sync] Found ticket via direct ticketId: ${pr.ticketId}`);
        return ticket;
      }
    }

    // Then try via workflowExecutionId
    if (pr.workflowExecutionId) {
      const workflowExecution = await prisma.workflowExecution.findUnique({
        where: { id: pr.workflowExecutionId },
        select: { workflowId: true },
      });

      if (workflowExecution) {
        const workflow = await prisma.workflow.findUnique({
          where: { id: workflowExecution.workflowId },
          select: { ticketId: true },
        });

        if (workflow && workflow.ticketId) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: workflow.ticketId },
            select: {
              id: true,
              xyneId: true,
              statusV2: true,
              stageName: true,
              conversationId: true,
              boardId: true,
              userGroupId: true,
              channelId: true,
              assignedTo: true,
              workspaceId: true,
            },
          });
          if (ticket) {
            logger.info(
              `[PR-Ticket-Sync] Found ticket via workflowExecutionId: ${pr.workflowExecutionId}`
            );

            // Backfill ticketId for faster future lookups
            if (!pr.ticketId) {
              try {
                await prisma.pullRequests.update({
                  where: { id: pr.id },
                  data: { ticketId: ticket.id },
                });
                logger.info(
                  `[PR-Ticket-Sync] Backfilled ticketId for PR ${pr.prId} -> ${ticket.id}`
                );
              } catch (error) {
                logger.error(
                  `[PR-Ticket-Sync] Failed to backfill ticketId for PR ${pr.prId}:`,
                  error
                );
              }
            }

            return ticket;
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if ticket status is terminal (should not be overridden)
   * Commented out since terminal status check is disabled
   */
  // private isTerminalTicketStatus(status: TicketStatus): boolean {
  //   return TERMINAL_TICKET_STATUSES.includes(status);
  // }

  /**
   * Send a message to the conversation about PR event
   */
  private async sendTicketUpdateMessage(
    ticket: TicketInfo,
    pr: PRInfo,
    params: PRStatusUpdateParams,
    senderId: string,
    stageChange?: { oldStageName: string | null; newStageName: string },
    remainingOpenPRs?: number
  ): Promise<void> {
    if (!ticket.conversationId) {
      logger.debug(
        `[PR-Ticket-Sync] No conversation for ticket ${ticket.xyneId}, skipping message`
      );
      return;
    }

    try {
      const { v4: uuidv4 } = await import('uuid');
      const { MessageType } = await import('@prisma/client');

      const message = this.formatPRMessage(pr, params, stageChange, remainingOpenPRs);

      await prisma.message.create({
        data: {
          messageId: uuidv4(),
          conversationId: ticket.conversationId,
          senderId,
          content: message,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: true,
          showInChannel: false,
          createdAt: new Date(),
          metadata: {
            activityType: 'PR',
            isTicketActivity: true,
            prWebhook: true,
            prUrl: pr.prUrl,
            prId: pr.prId,
            prEvent: params.prEvent,
          },
        },
      });

      logger.info(
        `[PR-Ticket-Sync] Sent PR ${params.prEvent} message to conversation ${ticket.conversationId}`
      );
    } catch (error) {
      logger.error(`[PR-Ticket-Sync] Failed to send ticket update message:`, error);
      // Don't throw - message sending shouldn't block the main flow
    }
  }

  /**
   * Format PR event message
   */
  private formatPRMessage(
    pr: PRInfo,
    params: PRStatusUpdateParams,
    stageChange?: { oldStageName: string | null; newStageName: string },
    remainingOpenPRs?: number
  ): string {
    const prLink = `<a href="${pr.prUrl}" target="_blank" rel="noopener noreferrer">#${pr.prId}</a>`;
    const action = this.getActionText(params.prEvent);
    const messageParts: string[] = [`PR ${prLink} ${action}`];

    if (
      stageChange &&
      stageChange.oldStageName &&
      stageChange.oldStageName !== stageChange.newStageName
    ) {
      messageParts.push(`${stageChange.oldStageName} → ${stageChange.newStageName}`);
    }

    if (params.prAuthor) {
      messageParts.push(`author: ${params.prAuthor}`);
    }

    if (remainingOpenPRs && remainingOpenPRs > 0) {
      messageParts.push(`${remainingOpenPRs} PRs remaining`);
    }

    return messageParts.join(', ');
  }

  /**
   * Get human-readable action text for PR event
   */
  private getActionText(event: PRStatusEvent | string): string {
    const actionMap: Record<string, string> = {
      [PRStatusEvent.CREATED]: PRActionText.RAISED,
      [PRStatusEvent.UPDATED]: PRActionText.UPDATED,
      [PRStatusEvent.MERGED]: PRActionText.MERGED,
      [PRStatusEvent.DECLINED]: PRActionText.DECLINED,
      [PRStatusEvent.DELETED]: PRActionText.DELETED,
    };
    return actionMap[event] || PRActionText.UPDATED;
  }

  /**
   * Assign a user to a ticket with the specified responsibility
   * Creates ticket assignment, activity log, and system message
   */
  private async assignUserToTicket(
    ticket: TicketInfo,
    assignedUserId: string,
    responsibility: 'PR_REVIEWER' | 'QA',
    fieldName: 'prReviewerId' | 'qaId',
    roleName: string,
    updatedBy: string,
    assignmentType: AssignmentType
  ): Promise<void> {
    // Find existing assignment
    const existingAssignment = await prisma.ticketAssignment.findFirst({
      where: {
        ticketId: ticket.id,
        ...(responsibility === 'PR_REVIEWER'
          ? { userId: assignedUserId, userResponsibility: responsibility }
          : { userResponsibility: responsibility }
        ),
      },
    });

    const oldValue = existingAssignment?.userId;

    // For PR_REVIEWER, skip if already assigned. For QA, update or create
    if (responsibility === 'PR_REVIEWER' && existingAssignment) {
      logger.info(
        `[PR-Ticket-Sync] User ${assignedUserId} already assigned as ${responsibility} for ticket ${ticket.xyneId}`
      );
      return;
    }

    // Create or update assignment
    if (existingAssignment && responsibility === 'QA') {
      await prisma.ticketAssignment.update({
        where: { id: existingAssignment.id },
        data: { userId: assignedUserId },
      });
      
      // Trigger side effect handler to create activity for update
      const userContext = await this.fetchUserContext(updatedBy);
      const handler = new TicketAssignmentsSideEffectHandler(userContext);
      handler.onUpdate({
        entityId: existingAssignment.id,
        entityType: 'ticket_assignments',
        operation: 'update',
        args: { userId: assignedUserId },
      }).catch(err => logger.error('[PR-Ticket-Sync] Side-effect handler error on update:', err));
    } else {
      const newAssignment = await prisma.ticketAssignment.create({
        data: {
          ticketId: ticket.id,
          userId: assignedUserId,
          userResponsibility: responsibility,
          createdBy: updatedBy,
        },
      });
      
      // Trigger side effect handler to create activity
      const userContext = await this.fetchUserContext(updatedBy);
      const handler = new TicketAssignmentsSideEffectHandler(userContext);
      handler.onInsert({
        entityId: newAssignment.id,
        entityType: 'ticket_assignments',
        operation: 'insert',
      }).catch(err => logger.error('[PR-Ticket-Sync] Side-effect handler error on insert:', err));
    }

    logger.info(
      `[PR-Ticket-Sync] Successfully assigned ${assignmentType} (${assignedUserId}) to ticket ${ticket.xyneId}`
    );

    // Create activity log
    await prisma.ticketActivity.create({
      data: {
        ticketId: ticket.id,
        updatedBy,
        activityType: 'ASSIGNED_TO',
        value: {
          field: fieldName,
          oldValue: responsibility === 'PR_REVIEWER' ? null : oldValue,
          newValue: assignedUserId,
        },
      },
    });

    // Create system message
    await this.createAssignmentSystemMessage(
      ticket,
      assignedUserId,
      updatedBy,
      roleName
    );
  }

  /**
   * Create a system message for assignment activity
   */
  private async createAssignmentSystemMessage(
    ticket: TicketInfo,
    assignedUserId: string,
    updatedBy: string,
    roleName: string
  ): Promise<void> {
    if (!ticket.conversationId) {
      return;
    }

    const [assignedUser, updatedByUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: assignedUserId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: updatedBy },
        select: { name: true },
      }),
    ]);

    const activityMessage = `${updatedByUser?.name || 'Bitbucket Bot'} assigned ${roleName} ${assignedUser?.name || assignedUserId}`;

    await prisma.message.create({
      data: {
        messageId: uuidv4(),
        conversationId: ticket.conversationId,
        senderId: updatedBy,
        content: activityMessage,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        isSent: true,
        showInChannel: false,
        createdAt: new Date(),
        metadata: {
          activityType: ActivityType.ASSIGNED_TO,
          isTicketActivity: true,
        },
      },
    });

    logger.info(
      `[PR-Ticket-Sync] Created system message for ${roleName} assignment on ticket ${ticket.xyneId}`
    );
  }

  /**
   * Handle auto-assignment based on PR event
   * - PR CREATED/UPDATED → assign PR_REVIEWER to TicketAssignment.prReviewerId array
   * - PR MERGED → assign QA to TicketAssignment.qaId
   */
  private async handleAssignmentBasedOnPREvent(
    ticket: TicketInfo,
    prEvent: PRStatusEvent,
    updatedBy: string,
    stageEvent?: PRStatusEvent
  ): Promise<void> {
    // Skip if ticket doesn't have a user group
    if (!ticket.userGroupId) {
      logger.info(
        `[PR-Ticket-Sync] Skipping assignment for ticket ${ticket.xyneId}: no userGroupId`
      );
      return;
    }

    try {
      let assignmentType: AssignmentType | null = null;
      let fieldToUpdate: 'prReviewerId' | 'qaId' | null = null;

      // Use stageEvent (if provided) for assignment decisions so that DECLINED/DELETED
      // events that fall back to the MERGED stage also trigger QA assignment.
      const effectiveEvent = stageEvent ?? prEvent;

      // Determine assignment type based on effective event
      if (effectiveEvent === PRStatusEvent.CREATED || effectiveEvent === PRStatusEvent.UPDATED) {
        assignmentType = AssignmentType.PR_REVIEWER;
        fieldToUpdate = 'prReviewerId';
        logger.info(
          `[PR-Ticket-Sync] PR ${effectiveEvent} event for ticket ${ticket.xyneId} - assigning PR_REVIEWER`
        );
      } else if (effectiveEvent === PRStatusEvent.MERGED) {
        assignmentType = AssignmentType.QA;
        fieldToUpdate = 'qaId';
        logger.info(
          `[PR-Ticket-Sync] PR MERGED event for ticket ${ticket.xyneId} - assigning QA`
        );
      }

      // Only proceed if we have an assignment type to handle
      if (!assignmentType || !fieldToUpdate) {
        return;
      }

      // Call assignment engine with the appropriate type
      // For PR_REVIEWER, exclude the ticket assignee to avoid self-review
      const excludeUserId = assignmentType === AssignmentType.PR_REVIEWER ? (ticket.assignedTo ?? undefined) : undefined;
      const assignmentResult = await evaluateAssignmentRule(
        ticket.userGroupId,
        ticket.boardId,
        assignmentType,
        excludeUserId
      );

      if (!assignmentResult.assignedUserId) {
        logger.warn(
          `[PR-Ticket-Sync] No ${assignmentType} user found for ticket ${ticket.xyneId}. Reason: ${assignmentResult.reason}`
        );
        return;
      }

      const assignedUserId = assignmentResult.assignedUserId;

      // Handle assignment based on field type
      const responsibility = fieldToUpdate === 'prReviewerId' ? 'PR_REVIEWER' : 'QA';
      const roleName = fieldToUpdate === 'prReviewerId' ? 'PR Reviewer' : 'QA';

      await this.assignUserToTicket(
        ticket,
        assignedUserId,
        responsibility,
        fieldToUpdate,
        roleName,
        updatedBy,
        assignmentType
      );

      // Sync workload mapping for the assigned user
      try {
        await syncUserWorkload(
          assignmentResult.assignedUserId,
          ticket.userGroupId,
          ticket.boardId,
          updatedBy
        );
        logger.info(
          `[PR-Ticket-Sync] Synced workload for ${assignmentType} user ${assignmentResult.assignedUserId}`
        );
      } catch (workloadError) {
        logger.error(
          `[PR-Ticket-Sync] Error syncing workload for user ${assignmentResult.assignedUserId}:`,
          workloadError
        );
      }

    } catch (error) {
      logger.error(
        `[PR-Ticket-Sync] Error handling assignment for ticket ${ticket.xyneId}:`,
        error
      );
    }
  }
}

// Singleton instance for use across the application
export const prTicketStatusSyncService = new PRTicketStatusSyncService();
