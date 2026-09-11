import Bull from 'bull';
import { ActivityClassification, ActivityType, EmailType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { emailClassificationQueue, type EmailClassificationJobData } from '@/queues/emailClassificationQueue';
import { EmailClassificationService } from '@/services/emailClassificationService';
import { buildEmailMetadata } from '@/types/classification';
import { DatabaseClient } from '@/database/client';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { activityService } from '@/services/activity/activityService';
import type { BoardMetadata } from '@xyne/shared';
import { emitTicketUpdated } from '@/automations/triggers/ticket-updated.trigger';
import { runAsServiceActor } from '@/database/tenant/context';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import type { TicketLike } from '@/automations/triggers/ticket-context';

const emailClassificationService = new EmailClassificationService();
const prisma = DatabaseClient.getInstance();
const EMAIL_FETCH_MAX_RETRIES = 3;
const EMAIL_FETCH_RETRY_DELAY_MS = 500;

function shouldAssignTicketPerson(
  boardId: string | null,
  groupChanged: boolean,
  ticketIsUnassigned: boolean,
  effectiveGroupId: string | null,
): boolean {
  // ASSIGN RULE:
  // 1. Group changed → assign to someone in the new group
  // 2. Ticket is unassigned + classification yielded a group → assign
  return boardId !== null && (
    groupChanged ||
    (ticketIsUnassigned && effectiveGroupId !== null)
  );
}

class EmailClassificationWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await emailClassificationQueue.initialize();

    const queue = emailClassificationQueue.getQueue();

    queue.process('classify', 5, async (job: Bull.Job<EmailClassificationJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[EMAIL-CLASSIFICATION-WORKER] Job ${job.id} permanently failed — ticket ${job.data.ticketId}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[EMAIL-CLASSIFICATION-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<EmailClassificationJobData>): Promise<void> {
    // Background job → no HTTP tenant scope. Resolve the channel's workspace and
    // open a tenant context so every Prisma write below (ticketActivity, activity,
    // workload, assignments) gets workspaceId stamped instead of leaking NULL.
    const channel = await prisma.channel.findUnique({
      where: { id: job.data.channelId },
      select: { workspaceId: true },
    });
    if (!channel?.workspaceId) {
      logger.error('[EMAIL-CLASSIFICATION-WORKER] Channel not found or has no workspaceId', {
        channelId: job.data.channelId,
        ticketId: job.data.ticketId,
      });
      throw new Error(`EmailClassificationWorker: channel ${job.data.channelId} not found or has no workspaceId`);
    }
    return runAsServiceActor('email-classification-worker', channel.workspaceId,
      () => this.classifyAndAssign(job, channel.workspaceId),
    );
  }

  private async classifyAndAssign(job: Bull.Job<EmailClassificationJobData>, workspaceId: string): Promise<void> {
    const { ticketId, channelId, emailId, groupId } = job.data;
    const systemActorId = await getAutomationsBotUserId(workspaceId);
    // If explicit flags provided (retrigger path), respect them; otherwise run both (normal ingestion path)
    const runClassification = job.data.runClassification ?? true;
    const runPriority = job.data.runPriority ?? true;

    logger.info(`[EMAIL-CLASSIFICATION-WORKER] Processing job ${job.id} — ticket ${ticketId} runClassification=${runClassification} runPriority=${runPriority}`);

    if (!runClassification && !runPriority) {
      logger.info(`[EMAIL-CLASSIFICATION-WORKER] Nothing to run for ticket ${ticketId}, skipping`);
      return;
    }

    const fetchEmailRecord = () => prisma.email.findUnique({
      where: { id: emailId },
      select: { subject: true, body: true, from: true, to: true, cc: true, bcc: true, replyTo: true, createdAt: true, type: true },
    });
    let emailRecord = await fetchEmailRecord();
    for (let retry = 0; !emailRecord && retry < EMAIL_FETCH_MAX_RETRIES; retry++) {
      await new Promise(resolve => setTimeout(resolve, EMAIL_FETCH_RETRY_DELAY_MS));
      emailRecord = await fetchEmailRecord();
    }
    if (!emailRecord) {
      logger.warn(`[EMAIL-CLASSIFICATION-WORKER] Email ${emailId} not found, skipping classification for ticket ${ticketId}`);
      return;
    }

    let classificationData: {
      result: { category: string; subCategory: string | null; rawOutput: Record<string, unknown>; priority?: any };
      config: any;
    } | null = null;

    try {
      classificationData = await emailClassificationService.classify(channelId, emailRecord.subject, emailRecord.body, {
        emailMetadata: buildEmailMetadata(emailRecord),
      });
    } catch (error) {
      logger.error(
        `[EMAIL-CLASSIFICATION-WORKER] Classification failed for ticket ${ticketId}:`,
        error instanceof Error ? error.message : error,
      );
      // Continue with fallback — classification failure shouldn't leave ticket unassigned
    }

    let resolvedGroupId: string | null = null;
    let effectiveGroupId: string | null = groupId ?? null;

    if (classificationData) {
      const { result, config } = classificationData;

      if (runClassification) {
        resolvedGroupId = await emailClassificationService.resolveUserGroup(result, config);
        // Fall back to the channel-default group when the AI category has no
        // mapping row — same guarantee as the classification-failure path:
        // an unmapped category must not leave the ticket unassigned.
        effectiveGroupId = resolvedGroupId ?? groupId ?? null;
        if (!resolvedGroupId && groupId) {
          logger.warn(
            `[EMAIL-CLASSIFICATION-WORKER] No mapping for AI category "${result.category}" on ticket ${ticketId}, falling back to channel default group ${groupId}`,
          );
        }

        // Only store if classification actually produced data. Store the true
        // AI resolution (null when unmapped) — the default-group fallback is
        // an assignment concern, not part of the classification result.
        if (result && Object.keys(result.rawOutput ?? {}).length > 0) {
          await emailClassificationService.storeOnTicket(ticketId, result, resolvedGroupId, {
            config,
            actorId: systemActorId,
          });
        }
      }
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        workspaceId: true,
        userGroupId: true,
        assignedTo: true,
        boardId: true,
        projectId: true,
        channelId: true,
        conversationId: true,
        priority: true,
      },
    });
    if (!ticket) {
      logger.warn(`[EMAIL-CLASSIFICATION-WORKER] Ticket ${ticketId} not found, skipping assignment.`);
      return;
    }

    const groupChanged = effectiveGroupId !== null && effectiveGroupId !== ticket.userGroupId;
    const ticketIsUnassigned = !ticket.assignedTo;

    const priorityAboveThreshold =
      runPriority &&
      classificationData?.result?.priority &&
      classificationData.result.priority.confidence >= (classificationData.config.priorityClassificationThreshold ?? 0.5);

    const shouldAssignPerson = shouldAssignTicketPerson(
      ticket.boardId,
      groupChanged,
      ticketIsUnassigned,
      effectiveGroupId,
    );

    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Track meaningful updates separately from the automatic updatedAt bump
    let hasMeaningfulUpdates = false;

    if (groupChanged) {
      updatePayload.userGroupId = effectiveGroupId;
      hasMeaningfulUpdates = true;
    }
    if (priorityAboveThreshold) {
      updatePayload.priority = classificationData!.result.priority!.priority;
      updatePayload.aiPriority = classificationData!.result.priority!.priority;
      hasMeaningfulUpdates = true;
    }

    let newAssignedTo: string | undefined;
    let assignmentSucceeded = false;

    if (shouldAssignPerson && emailRecord.type !== EmailType.COMPOSE) {
      try {
        const boardRow = await prisma.board.findUnique({
          where: { id: ticket.boardId! },
          select: { metadata: true },
        });
        const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

        if (
          (Array.isArray(boardMetadata?.assignmentRoles) && boardMetadata!.assignmentRoles!.length > 0)
          || boardMetadata?.fullRoleAssignment === true
        ) {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId,
            userGroupId: effectiveGroupId!,
            boardId: ticket.boardId!,
            createdBy: systemActorId,
            projectId: ticket.projectId ?? undefined,
            channelId: ticket.channelId ?? undefined,
          });
          const primaryUserId = primaryUserIdOf(fullRoles);
          if (primaryUserId) {
            newAssignedTo = primaryUserId;
            assignmentSucceeded = true;
            logger.info(
              `[EMAIL-CLASSIFICATION-WORKER] Full-role assigned ticket ${ticketId}: primary=${primaryUserId}`,
            );
          }
        } else {
          const assignmentResult = await evaluateAssignmentRule(
            effectiveGroupId!,
            ticket.boardId!,
            AssignmentType.TICKET_ASSIGNEE,
            undefined,
            ticket.projectId ?? undefined,
            ticket.channelId ?? undefined,
          );
          if (assignmentResult.assignedUserId) {
            newAssignedTo = assignmentResult.assignedUserId;
            assignmentSucceeded = true;
            logger.info(
              `[EMAIL-CLASSIFICATION-WORKER] Assigned ticket ${ticketId} to user ${newAssignedTo}`,
            );
          } else {
            logger.warn(
              `[EMAIL-CLASSIFICATION-WORKER] No eligible user for ticket ${ticketId}: ${assignmentResult.reason}`,
            );
          }
        }

        if (newAssignedTo) {
          updatePayload.assignedTo = newAssignedTo;
          hasMeaningfulUpdates = true;
        }
      } catch (error) {
        logger.error(
          `[EMAIL-CLASSIFICATION-WORKER] Assignment engine failed for ticket ${ticketId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (hasMeaningfulUpdates) {
      const updatedTicket = await prisma.ticket.update({
        where: { id: ticketId },
        data: updatePayload,
      });

      try {
        await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);
      } catch (error) {
        logger.warn(
          `[EMAIL-CLASSIFICATION-WORKER] ticketMd sync failed for ticket ${ticketId}:`,
          error,
        );
      }

      if (newAssignedTo && assignmentSucceeded) {
        void emitTicketUpdated({
          ticket: updatedTicket as TicketLike,
          changes: { assignedTo: { previousValue: ticket.assignedTo ?? null, newValue: newAssignedTo } },
          performedById: systemActorId,
        });
        try {
          await syncUserWorkload(
            newAssignedTo,
            effectiveGroupId!,
            ticket.boardId!,
            systemActorId,
          );
          logger.info(
            `[EMAIL-CLASSIFICATION-WORKER] Synced workload for user ${newAssignedTo}`,
          );
        } catch (error) {
          logger.error(
            `[EMAIL-CLASSIFICATION-WORKER] Workload sync failed for user ${newAssignedTo}:`,
            error,
          );
        }
      }
    }

    // Activity logging

    if (newAssignedTo && assignmentSucceeded) {
      const assignReason = resolvedGroupId
        ? 'AI classification'
        : 'Default channel group';

      try {
        // 1. Ticket activity row (appears in the ticket's activity log)
        await prisma.ticketActivity.create({
          data: {
            ticketId,
            workspaceId: ticket.workspaceId,
            updatedBy: systemActorId,
            activityType: ActivityType.ASSIGNED_TO,
            value: {
              field: 'assignedTo',
              oldValue: ticket.assignedTo ?? null,
              newValue: newAssignedTo,
              reason: assignReason,
              aiClassified: !!resolvedGroupId,
            },
          },
        });
        logger.info(`[EMAIL-CLASSIFICATION-WORKER] Created ticket activity for auto-assignment on ${ticketId}`);
      } catch (error) {
        logger.error(
          `[EMAIL-CLASSIFICATION-WORKER] Failed to create ticket activity for ${ticketId}:`,
          error,
        );
      }

      try {
        // 2. In-app notification activity (appears in the user's activity feed)
        await activityService.createActivity({
          userId: newAssignedTo,
          workspaceId: ticket.workspaceId,
          actorAction: 'ticket_assigned',
          actionSource: 'ticket',
          actionSourceId: ticketId,
          ticketId,
          conversationId: ticket.conversationId ?? undefined,
          channelId: ticket.channelId ?? undefined,
          actorId: systemActorId,
          classification: ActivityClassification.ACTIONABLE,
        });
        logger.info(`[EMAIL-CLASSIFICATION-WORKER] Created in-app activity for user ${newAssignedTo} on ${ticketId}`);
      } catch (error) {
        logger.error(
          `[EMAIL-CLASSIFICATION-WORKER] Failed to create in-app activity for ${ticketId}:`,
          error,
        );
      }
    }

    if (priorityAboveThreshold) {
      try {
        await prisma.ticketActivity.create({
          data: {
            ticketId,
            workspaceId: ticket.workspaceId,
            updatedBy: systemActorId,
            activityType: ActivityType.PRIORITY,
            value: {
              field: 'priority',
              oldValue: ticket.priority ?? null,
              newValue: classificationData!.result.priority!.priority,
              reason: 'AI priority classification',
            },
          },
        });
        logger.info(`[EMAIL-CLASSIFICATION-WORKER] Created ticket activity for AI priority change on ${ticketId}`);
      } catch (error) {
        logger.error(
          `[EMAIL-CLASSIFICATION-WORKER] Failed to create priority activity for ${ticketId}:`,
          error,
        );
      }

      logger.info(
        `[EMAIL-CLASSIFICATION-WORKER] Set priority to ${classificationData!.result.priority!.priority} for ticket ${ticketId}`,
      );
    }

    if (groupChanged) {
      logger.info(
        resolvedGroupId
          ? `[EMAIL-CLASSIFICATION-WORKER] Mapped ticket ${ticketId} to AI-resolved group ${effectiveGroupId}`
          : `[EMAIL-CLASSIFICATION-WORKER] Fell back to default group ${effectiveGroupId} for ticket ${ticketId}`,
      );
    }
  }

  async shutdown(): Promise<void> {
    await emailClassificationQueue.close();
    this.isInitialized = false;
    logger.info('[EMAIL-CLASSIFICATION-WORKER] Shut down');
  }
}

export const emailClassificationWorker = new EmailClassificationWorker();
