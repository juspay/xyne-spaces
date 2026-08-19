import Bull from 'bull';
import { randomUUID } from 'crypto';
import {
  ActivityType,
  TicketPriority,
  TicketStatusV2,
  NudgeKind,
  SurfaceAreaType,
  MessageType,
  ConversationParticipation,
} from '@xyne/shared';
import { serializeTicketMd, type TicketCardSummary } from '@xyne/shared';
import type { BoardMetadata } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { TicketIdService } from '@/services/ticketIdService';
import { dualWriteTicketTag } from '@/services/ticketTagDualWriteService';
import { messageMetadataService } from '@/services/messageMetadataService';
import {
  bulkTicketCreationQueue,
  type BulkTicketCreationJobData,
  type BulkTicketCreationInput,
} from '@/queues/BulkTicketCreationQueue';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { nudgeService } from '@/nudges/services/surfaceNudgeService';
import { runWithContext } from '@/database/tenant/context';

const prisma = DatabaseClient.getInstance();
const conversationRepository = new ConversationRepository();
const channelRepository = new ChannelRepository();
const messageRepository = new MessageRepository();

class BulkTicketCreationWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await bulkTicketCreationQueue.initialize();

    const queue = bulkTicketCreationQueue.getQueue();

    queue.process('sub-ticket', 5, async (job: Bull.Job<BulkTicketCreationJobData>) => {
      const { userId, parentWorkspaceId } = job.data;
      return runWithContext(
        { userId, workspaceId: parentWorkspaceId },
        () => this.processJob(job),
      );
    });

    queue.process('bulk-ticket', 5, async (job: Bull.Job<BulkTicketCreationJobData>) => {
      const { userId, parentWorkspaceId } = job.data;
      return runWithContext(
        { userId, workspaceId: parentWorkspaceId },
        () => this.processJob(job),
      );
    });

    queue.on('failed', async (job, err) => {
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < maxAttempts) {
        logger.warn(
          `[BULK-TICKET-CREATION-WORKER] Job ${job.id} failed on attempt ${job.attemptsMade}/${maxAttempts}, will retry — parent ${job.data.parentTicketId ?? 'none'}:`,
          err,
        );
        return;
      }
      logger.error(
        `[BULK-TICKET-CREATION-WORKER] Job ${job.id} permanently failed after ${job.attemptsMade} attempts — parent ${job.data.parentTicketId ?? 'none'}, ${job.data.subTickets.length} ticket(s):`,
        err,
      );
      try {
        const { sourceMessageId, sourceType, channelId, projectId, parentTicketId, subTickets, userId, parentWorkspaceId } = job.data;
        if (!sourceMessageId || !projectId) {
          logger.warn('[BULK-TICKET-CREATION-WORKER] Missing source info, skipping nudge creation', {
            jobId: job.id,
            sourceMessageId,
            projectId,
          });
          return;
        }
        await runWithContext(
          { userId, workspaceId: parentWorkspaceId },
          () => nudgeService.persistCandidates({
            sourceId: sourceMessageId,
            sourceType: sourceType ?? SurfaceAreaType.MESSAGE,
            nudgeKind: NudgeKind.BULK_TICKET_CREATION_FAILED,
            projectId,
            priority: 'high',
            candidates: [
              {
                title: `${subTickets.length} ticket${subTickets.length === 1 ? '' : 's'} failed to create`,
                description: subTickets.map(s => `• ${s.title}`).join('\n'),
                priority: 'high',
                actions: {
                  actionType: 'RETRY_BULK_TICKET_CREATION',
                  mode: parentTicketId ? 'parent-sub' : 'all-parents',
                  channelId,
                  projectId,
                  parentTicketId,
                  failedInputs: subTickets.map(s => ({
                    title: s.title,
                    description: s.description,
                    priority: s.priority,
                    statusV2: s.statusV2,
                    eta: s.eta ? new Date(s.eta).toISOString() : null,
                    channelId: s.channelId,
                    boardId: s.boardId,
                    assignedTo: s.assignedTo,
                    userGroupId: s.userGroupId,
                    tags: s.tags,
                    ticketType: s.ticketType,
                    stageName: s.stageName,
                    dynamicFields: s.dynamicFields,
                    merchantId: s.merchantId,
                    clientRowId: s.clientRowId,
                  })),
                },
                visibleTo: subTickets[0]?.createdBy,
              },
            ],
          }),
        );
        logger.info(`[BULK-TICKET-CREATION-WORKER] Created failure nudge for job ${job.id}`);
      } catch (nudgeErr) {
        logger.error('[BULK-TICKET-CREATION-WORKER] Failed to create failure nudge', {
          jobId: job.id,
          error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
        });
      }
    });

    this.isInitialized = true;
    logger.info('[BULK-TICKET-CREATION-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<BulkTicketCreationJobData>): Promise<void> {
    const { parentTicketId, parentWorkspaceId, subTickets, sourceMessageId, sourceType, channelId, projectId } = job.data;
    logger.info(
      `[BULK-TICKET-CREATION-WORKER] Processing job ${job.id} — parent ${parentTicketId ?? 'none'}, ${subTickets.length} ticket(s)`,
    );

    const failures: Array<{ input: BulkTicketCreationInput; error: string }> = [];

    for (const subTicket of subTickets) {
      try {
        await this.createSingleTicket({ parentTicketId, parentWorkspaceId, subTicket });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `[BULK-TICKET-CREATION-WORKER] Failed to create ticket "${subTicket.title}":`,
          error,
        );
        failures.push({ input: subTicket, error: message });
      }
    }

    if (failures.length > 0 && sourceMessageId && projectId) {
      await this.createFailureNudge({
        jobId: job.id,
        sourceMessageId,
        sourceType,
        channelId,
        projectId,
        parentTicketId,
        failures,
      });
    } else if (failures.length > 0) {
      logger.warn('[BULK-TICKET-CREATION-WORKER] Skipping failure nudge — missing sourceMessageId or projectId', {
        jobId: job.id,
        sourceMessageId,
        projectId,
        failureCount: failures.length,
      });
    }

    if (failures.length === subTickets.length && subTickets.length > 0) {
      throw new Error(`All ${subTickets.length} ticket(s) failed to create`);
    }
  }

  private async createSingleTicket({
    parentTicketId,
    parentWorkspaceId,
    subTicket,
  }: {
    parentTicketId: string | null;
    parentWorkspaceId: string;
    subTicket: BulkTicketCreationInput;
  }): Promise<void> {
    let finalAssignedTo = subTicket.assignedTo;
    let pendingFullRoleAssignment = false;

    if (subTicket.userGroupId && !subTicket.assignedTo) {
      try {
        const boardMetaRow = await prisma.board.findUnique({
          where: { id: subTicket.boardId },
          select: { metadata: true },
        });
        const boardMeta = boardMetaRow?.metadata as BoardMetadata | undefined;

        if (
          (Array.isArray(boardMeta?.assignmentRoles) && boardMeta!.assignmentRoles!.length > 0) ||
          boardMeta?.fullRoleAssignment === true
        ) {
          pendingFullRoleAssignment = true;
        } else {
          const assignmentResult = await evaluateAssignmentRule(
            subTicket.userGroupId,
            subTicket.boardId,
            undefined,
            undefined,
            subTicket.projectId,
            subTicket.channelId,
          );
          if (assignmentResult.assignedUserId) {
            finalAssignedTo = assignmentResult.assignedUserId;
          }
        }
      } catch (error) {
        logger.error('[BULK-TICKET-CREATION-WORKER] Error during auto-assignment:', error);
      }
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const xyneId = await TicketIdService.generateTicketId(tx, subTicket.projectId);

      const initialMessageId = randomUUID();
      const conversation = await conversationRepository.create({
        channelId: subTicket.channelId,
        createdBy: subTicket.createdBy,
        initialMessageId,
        doNotPostToChannel: false,
      });
      const conversationId = conversation.conversationId;
      const channelWorkspaceId = await channelRepository.getWorkspaceId(subTicket.channelId);

      const firstStage = subTicket.stageName
        ? null
        : await tx.stage.findFirst({
            where: { boardId: subTicket.boardId },
            orderBy: { sequenceNumber: 'asc' },
            select: { name: true, defaultTicketStatusV2: true },
          });

      const createdTicket = await tx.ticket.create({
        data: {
          title: subTicket.title,
          description: subTicket.description ?? '',
          createdBy: subTicket.createdBy,
          updatedBy: subTicket.updatedBy,
          conversationId,
          channelId: subTicket.channelId,
          xyneId,
          projectId: subTicket.projectId,
          workspaceId: channelWorkspaceId,
          boardId: subTicket.boardId,
          statusV2: subTicket.statusV2 ?? firstStage?.defaultTicketStatusV2 ?? TicketStatusV2.TODO,
          priority: subTicket.priority ?? TicketPriority.LOW,
          stageName: subTicket.stageName ?? firstStage?.name ?? 'Backlog',
          assignedTo: finalAssignedTo,
          userGroupId: subTicket.userGroupId,
          eta: subTicket.eta ? new Date(subTicket.eta) : null,
          ticketType: subTicket.ticketType,
          merchantId: subTicket.merchantId,
          lastEmailAt: new Date(),
          metadata: {
            parentTicketId,
            ...(subTicket.dynamicFields ?? {}),
          },
        },
      });

      await messageRepository.createWithExecutionId(
        {
          conversationId,
          senderId: subTicket.createdBy,
          content: `Ticket created: ${subTicket.title}`,
          msgType: MessageType.SYSTEM,
          showInChannel: false,
          metadata: { ticketId: createdTicket.id, xyneId, messageSubtype: 'sub_ticket_created' },
        },
        initialMessageId,
      );

      await messageMetadataService.syncInitialMessageMd(conversationId);

      const ticketMd = serializeTicketMd({
        id: createdTicket.id,
        title: createdTicket.title,
        description: createdTicket.description,
        statusV2: createdTicket.statusV2 as TicketCardSummary['statusV2'],
        priority: createdTicket.priority as TicketCardSummary['priority'],
        assignedTo: createdTicket.assignedTo ?? null,
        createdBy: createdTicket.createdBy,
        createdAt: createdTicket.createdAt.getTime(),
        eta: createdTicket.eta ? createdTicket.eta.getTime() : null,
        xyneId: createdTicket.xyneId,
        stageName: createdTicket.stageName,
        ticketType: createdTicket.ticketType ?? null,
        channelId: createdTicket.channelId,
        conversationId: createdTicket.conversationId,
      });

      await tx.conversation.update({
        where: { conversationId },
        data: { ticketId: createdTicket.id, ticket_md: ticketMd },
      });

      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: { conversationId, userId: subTicket.createdBy },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId: subTicket.createdBy,
          workspaceId: channelWorkspaceId,
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
          joinedAt: new Date(),
          channelId: subTicket.channelId,
        },
        update: {
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
        },
      });

      if (subTicket.tags?.length) {
        await tx.ticketTag.createMany({
          data: subTicket.tags.map(name => ({ ticketId: createdTicket.id, name, workspaceId: channelWorkspaceId })),
          skipDuplicates: true,
        });
        for (const name of subTicket.tags) {
          await dualWriteTicketTag(createdTicket.id, name, tx);
        }
      }

      if (parentTicketId) {
        const subTicketRow = await tx.subTicket.create({
          data: {
            title: subTicket.title,
            description: subTicket.description,
            createdBy: subTicket.createdBy,
            updatedBy: subTicket.updatedBy,
            conversationId,
            mappedTicketId: createdTicket.id,
            workspaceId: parentWorkspaceId,
          },
        });

        await tx.ticketSubTicketMapping.create({
          data: { ticketId: parentTicketId, subTicketId: subTicketRow.id, workspaceId: parentWorkspaceId },
        });

        await tx.ticketActivity.create({
          data: {
            ticketId: parentTicketId,
            updatedBy: subTicket.updatedBy,
            workspaceId: parentWorkspaceId,
            activityType: ActivityType.SUBTICKET_CREATED,
            value: {
              subTicketId: subTicketRow.id,
              subTicketTitle: subTicketRow.title,
              ticketId: createdTicket.id,
              ticketXyneId: xyneId,
            },
          },
        });
      }

      logger.info(
        `[BULK-TICKET-CREATION-WORKER] Created ticket ${xyneId} (${createdTicket.id})${parentTicketId ? ` for parent ${parentTicketId}` : ''}`,
      );

      return createdTicket;
    });

    vespaQueue.addJob({
      schema: ticketSchema,
      jobType: 'feed',
      docId: ticket.id,
      userId: subTicket.createdBy,
      ...(parentWorkspaceId ? { workspaceId: parentWorkspaceId } : {}),
    }).catch(async (error) => {
      logger.error(`[BULK-TICKET-CREATION-WORKER] Error queuing Vespa job for ticket ${ticket.id}:`, error);
    });

    let fraAssignedUserId: string | null = null;
    if (pendingFullRoleAssignment && subTicket.userGroupId) {
      try {
        const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
          ticketId: ticket.id,
          userGroupId: subTicket.userGroupId,
          boardId: subTicket.boardId,
          createdBy: subTicket.createdBy,
          projectId: subTicket.projectId,
          channelId: subTicket.channelId,
        });
        const primaryUserId = primaryUserIdOf(fullRoles);
        if (primaryUserId) {
          const updatedTicket = await prisma.ticket.update({
            where: { id: ticket.id },
            data: { assignedTo: primaryUserId },
          });
          await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);
          fraAssignedUserId = primaryUserId;
          logger.info(`[BULK-TICKET-CREATION-WORKER] Full role assignment complete for ticket ${ticket.id}`);
        }
      } catch (error) {
        logger.error('[BULK-TICKET-CREATION-WORKER] Error during full role assignment:', error);
      }
    }

    const finalAssignedUserId = fraAssignedUserId || ticket.assignedTo;
    if (finalAssignedUserId && subTicket.userGroupId) {
      try {
        await syncUserWorkload(finalAssignedUserId, subTicket.userGroupId, subTicket.boardId, subTicket.createdBy);
        logger.info(`[BULK-TICKET-CREATION-WORKER] Synced workload for user ${finalAssignedUserId}`);
      } catch (error) {
        logger.error('[BULK-TICKET-CREATION-WORKER] Error syncing workload:', error);
      }
    }
  }

  private async createFailureNudge({
    jobId,
    sourceMessageId,
    sourceType,
    channelId,
    projectId,
    parentTicketId,
    failures,
  }: {
    jobId: string | number;
    sourceMessageId: string;
    sourceType?: SurfaceAreaType;
    channelId?: string;
    projectId: string;
    parentTicketId: string | null;
    failures: Array<{ input: BulkTicketCreationInput; error: string }>;
  }): Promise<void> {
    try {
      let existingParentTicket: { id: string; xyneId: string; conversationId: string } | null = null;
      let parentTitle: string | null = null;
      if (parentTicketId) {
        const parent = await prisma.ticket.findUnique({
          where: { id: parentTicketId },
          select: { id: true, xyneId: true, conversationId: true, title: true },
        });
        if (parent) {
          existingParentTicket = parent;
          parentTitle = parent.title;
        }
      }

      const failedInputs = failures.map(f => ({
        title: f.input.title,
        description: f.input.description,
        priority: f.input.priority,
        statusV2: f.input.statusV2,
        eta: f.input.eta ? new Date(f.input.eta).toISOString() : null,
        channelId: f.input.channelId,
        boardId: f.input.boardId,
        assignedTo: f.input.assignedTo,
        userGroupId: f.input.userGroupId,
        tags: f.input.tags,
        ticketType: f.input.ticketType,
        stageName: f.input.stageName,
        dynamicFields: f.input.dynamicFields,
        merchantId: f.input.merchantId,
        clientRowId: f.input.clientRowId,
      }));

      await nudgeService.persistCandidates({
        sourceId: sourceMessageId,
        sourceType: sourceType ?? SurfaceAreaType.MESSAGE,
        nudgeKind: NudgeKind.BULK_TICKET_CREATION_FAILED,
        projectId,
        priority: 'high',
        candidates: [
          {
            title: `${failures.length} ticket${failures.length === 1 ? '' : 's'} failed to create`,
            description: failures.map(f => `• ${f.input.title}`).join('\n'),
            priority: 'high',
            actions: {
              actionType: 'RETRY_BULK_TICKET_CREATION',
              mode: parentTicketId ? 'parent-sub' : 'all-parents',
              channelId,
              projectId,
              parentTicketId,
              parentTitle,
              existingParentTicket,
              failedInputs,
            },
            visibleTo: failures[0]?.input.createdBy,
          },
        ],
      });
      logger.info(`[BULK-TICKET-CREATION-WORKER] Created aggregated failure nudge for job ${jobId}`);
    } catch (nudgeErr) {
      logger.error('[BULK-TICKET-CREATION-WORKER] Failed to create failure nudge', {
        jobId,
        error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
      });
    }
  }

  async shutdown(): Promise<void> {
    await bulkTicketCreationQueue.close();
    this.isInitialized = false;
    logger.info('[BULK-TICKET-CREATION-WORKER] Shut down');
  }
}

export const bulkTicketCreationWorker = new BulkTicketCreationWorker();
