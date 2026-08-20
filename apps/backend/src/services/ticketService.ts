import { TicketRepository } from '../database/repositories/ticketRepository';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository';
import { ImageAttachment } from '@/workflows/types/workflow-enums';
import { ActivitySource } from '@/types/ticket';
import { DatabaseClient } from '@/database/client';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { Prisma } from '@prisma/client';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { websocketService } from '@/services/websocketService';
import { versionReleaseMappingService } from '@/services/release/versionReleaseMappingService';
import { BaseTicketType, isReleaseTicket, PRStatusEvent, BoardType, ActivityType, TicketStatusV2 } from '@xyne/shared';
import { ticketStageTransitionService } from './stageTransition/ticketStageTransitionService';
import { dualWriteTicketTags, dualDeleteTicketTag } from '@/services/ticketTagDualWriteService';


const prisma = DatabaseClient.getInstance();

const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^\.+/, '')
    .substring(0, 255)
    .trim();
};

export class TicketService {
  private ticketRepository: TicketRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
  }

  /**
   * Update ticket stage when a workflow is created or PR status changes
   * This method validates that the stage exists before updating
   * @param ticketId - The ticket ID to update
   * @param userId - The user who initiated the workflow (for activity tracking)
   * @param stage - The stage name (can be AI_STAGES, PR_STAGES, or any custom stage)
   * @param source - The source/origin of the update (INTERNAL or WEBHOOK)
   * @param prActivityData - Optional PR activity data (only used when source is WEBHOOK)
   */
  async updateTicketStageForWorkflow(
    ticketId: string,
    userId: string,
    stage: string,
    source: ActivitySource = ActivitySource.INTERNAL,
    prActivityData?: {
      prEvent: PRStatusEvent;
      prId: number;
      prUrl: string;
      repoName: string;
      sourceBranchName: string;
      destinationBranchName: string;
      pullRequestId?: string;
      prAuthor?: string;
      remainingOpenPRs?: number;
    }
  ): Promise<void> {
    try {
      // Get ticket with board information
      const ticket = await this.ticketRepository.getTicketWithBoard(ticketId);

      if (!ticket) {
        logger.warn(`[TicketService] Ticket ${ticketId} not found. Skipping stage update.`);
        return;
      }

      const { boardId } = ticket;

      if (ticket.board?.boardType === BoardType.FLOW) {
        const [currentStage, targetStage] = await Promise.all([
          prisma.stage.findFirst({ where: { boardId, name: ticket.stageName } }),
          prisma.stage.findFirst({ where: { boardId, name: stage } }),
        ]);
        if (!currentStage || !targetStage) {
          logger.warn(`[TicketService] FLOW stage not found for ${ticketId} → "${stage}"`);
          return;
        }
        const transition = await prisma.stageTransition.findUnique({
          where: {
            boardId_fromStageId_toStageId: {
              boardId,
              fromStageId: currentStage.id,
              toStageId: targetStage.id,
            },
          },
        });
        if (!transition) {
          logger.warn(`[TicketService] FLOW transition rejected for ${ticketId} → "${stage}"`);
          return;
        }
        await this.ticketRepository.updateTicketStage(ticketId, stage, userId, source, prActivityData);
        return;
      }

      // NON_LINEAR boards require the dedicated transition service (handles forms, approvals, SLA).
      if (ticket.board?.boardType === BoardType.NON_LINEAR) {
        const result = await ticketStageTransitionService.transitionTicket(ticketId, userId, stage, {
          isAutomation: true,
        });
        if (!result.success) {
          logger.warn(
            `[TicketService] NON_LINEAR stage transition failed for ticket ${ticketId} → "${stage}": ${result.message}`,
          );
        }
        return;
      }

      // Query the board to find the AI_PICKED_UP stage
      const targetStage = await prisma.stage.findFirst({
        where: {
          boardId: boardId,
          name: stage,
        },
      });

      // If stage doesn't exist in this board, skip the update
      if (!targetStage) {
        logger.warn(
          `[TicketService] "${stage}" stage not found in board ${boardId}. Skipping stage update for ticket ${ticketId}.`
        );
        return;
      }

      // Check if ticket is already in the target stage
      if (ticket.stageName === stage) {
        // For WEBHOOK source with PR data, we still need to call repository to create PR activity
        // even if the stage hasn't changed
        if (source === ActivitySource.WEBHOOK && prActivityData) {
          logger.info(
            `[TicketService] Ticket ${ticketId} is already in "${stage}" stage. Creating PR activity only.`
          );
          // Proceed to create PR activity without stage change
        } else {
          logger.info(
            `[TicketService] Ticket ${ticketId} is already in "${stage}" stage. Skipping update.`
          );
          return;
        }
      }

      // Update the ticket stage (this will also create the appropriate activity)
      await this.ticketRepository.updateTicketStage(
        ticketId,
        stage,
        userId,
        source,
        prActivityData
      );

      logger.debug(
        `[TicketService] Successfully updated ticket ${ticketId} to "${stage}" stage.`
      );
    } catch (error) {
      // Log the error but don't throw it - we don't want to fail workflow creation
      // if stage update fails
      logger.error(
        `[TicketService] Error updating ticket stage for workflow:`,
        error
      );
    }
  }

  async updateTicketAssignee(ticketId: string, userId: string, assigneeId: string): Promise<void> {
    try {
      await this.ticketRepository.updateTicketAssignee(ticketId, assigneeId, userId);
      logger.debug(`[TicketService] Successfully updated assignee for ticket ${ticketId} to user ${assigneeId}.`);
    } catch (error) {
      logger.error(`[TicketService] Error updating ticket assignee:`, error);
    }
  } 

  async asignUserGroupToTicket(ticketId: string, userId: string, groupId: string): Promise<void> {
    try {
      await this.ticketRepository.assignUserGroupToTicket(ticketId, userId, groupId);
      logger.debug(`[TicketService] Successfully assigned user group ${groupId} to ticket ${ticketId}.`);
    } catch (error) {
      logger.error(`[TicketService] Error assigning user group to ticket:`, error);
    }
  }


  /**
   * Generic ticket update — all fields updated via direct Prisma update.
   * Returns the list of fields that were updated.
   */

 async updateTicket(
    ticketId: string,
    userId: string,
    params: {
      assigneeId?: string;
      stage?: string;
      groupId?: string;
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
      eta?: string;
      tags?: string[];
    },
  ): Promise<string[]> {
    const updates: string[] = [];
    const data: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() };

    const existingTicket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { board: true },
    });
    if (!existingTicket) throw new Error('Ticket not found');
    const flowStageChange =
      existingTicket.board.boardType === BoardType.FLOW && (params.stage || params.status);
    if (flowStageChange) {
      const targetStageName = params.stage ?? params.status;
      if (!targetStageName || (params.status && params.status !== targetStageName)) {
        throw new Error('Flow status must match its target stage');
      }
      const [currentStage, targetStage] = await Promise.all([
        prisma.stage.findFirst({
          where: { boardId: existingTicket.boardId, name: existingTicket.stageName },
        }),
        prisma.stage.findFirst({
          where: { boardId: existingTicket.boardId, name: targetStageName },
        }),
      ]);
      if (!currentStage || !targetStage) throw new Error('Flow stage not found');
      const allowed = await prisma.stageTransition.findUnique({
        where: {
          boardId_fromStageId_toStageId: {
            boardId: existingTicket.boardId,
            fromStageId: currentStage.id,
            toStageId: targetStage.id,
          },
        },
      });
      if (!allowed) throw new Error('This Flow stage transition is not allowed');
      await this.ticketRepository.updateTicketStage(ticketId, targetStageName, userId);
      updates.push('stage', 'status');
    }

    if (params.assigneeId) { data['assignedTo'] = params.assigneeId; updates.push('assignee'); }
    if (params.stage && !flowStageChange) {
      data['stageName'] = params.stage; updates.push('stage');
    }
    if (params.groupId) { data['userGroupId'] = params.groupId; updates.push('group'); }
    if (params.title) { data['title'] = params.title; updates.push('title'); }
    if (params.description) { data['description'] = params.description; updates.push('description'); }
    if (params.priority) { data['priority'] = params.priority; updates.push('priority'); }
    if (params.status && !flowStageChange) { data['statusV2'] = params.status; updates.push('status'); }
    if (params.eta) { data['eta'] = new Date(params.eta); updates.push('eta'); }

    // Snapshot the fields that can change so we can emit TicketActivity
    // audit rows (old -> new) after the update, mirroring the activity model
    // used by the repository and Zero ticket-update paths.
    const prevSnapshot = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        assignedTo: true,
        stageName: true,
        userGroupId: true,
        title: true,
        description: true,
        priority: true,
        statusV2: true,
        eta: true,
      },
    });

    const previousCountsSnapshot = await buildKanbanCountsSnapshot(ticketId);
    const hasDirectUpdates = Object.keys(data).some(key => key !== 'updatedBy' && key !== 'updatedAt');
    const updatedTicket = hasDirectUpdates
      ? await prisma.ticket.update({ where: { id: ticketId }, data })
      : await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    let tagDiff: { added: string[]; removed: string[] } = { added: [], removed: [] };
    if (params.tags) {
      tagDiff = await this.updateTicketTags(ticketId, params.tags);
      updates.push('tags');
    }

    if (
      params.status === 'COMPLETED'
      && prevSnapshot
      && prevSnapshot.statusV2 !== TicketStatusV2.COMPLETED
      && isReleaseTicket(updatedTicket.ticketType as BaseTicketType | null)
    ) {
      // The ticket update above is already committed; deployed-version
      // bookkeeping must not fail the request.
      try {
        await versionReleaseMappingService.updateDeployedVersionOnCompletion(
          ticketId,
          updatedTicket.updatedAt,
        );
      } catch (error) {
        logger.error(
          `[VersionReleaseMapping] failed to update deployedVersion for ticket ${ticketId}:`,
          error,
        );
      }
    }
    // Write TicketActivity audit rows for every field that actually changed.
    // Best-effort: the ticket update above is already committed, so an audit
    // write failure must not fail the request.
    try {
      const activities: Array<{ activityType: ActivityType; value: Prisma.InputJsonValue }> = [];
      if (prevSnapshot) {
        if (params.assigneeId && prevSnapshot.assignedTo !== params.assigneeId) {
          activities.push({
            activityType: ActivityType.ASSIGNED_TO,
            value: { oldValue: prevSnapshot.assignedTo, newValue: params.assigneeId },
          });
        }
        if (params.stage && prevSnapshot.stageName !== params.stage) {
          activities.push({
            activityType: ActivityType.STAGE_NAME,
            value: {
              field: 'stageName',
              oldValue: prevSnapshot.stageName,
              newValue: params.stage,
              source: ActivitySource.INTERNAL,
            },
          });
        }
        if (params.groupId && prevSnapshot.userGroupId !== params.groupId) {
          activities.push({
            activityType: ActivityType.USER_GROUP_ID,
            value: { field: 'userGroupId', oldValue: prevSnapshot.userGroupId, newValue: params.groupId },
          });
        }
        if (params.title && prevSnapshot.title !== params.title) {
          activities.push({
            activityType: ActivityType.TITLE,
            value: { field: 'title', oldValue: prevSnapshot.title, newValue: params.title },
          });
        }
        if (params.description && prevSnapshot.description !== params.description) {
          activities.push({
            activityType: ActivityType.DESCRIPTION,
            value: { field: 'description', oldValue: prevSnapshot.description, newValue: params.description },
          });
        }
        if (params.priority && prevSnapshot.priority !== params.priority) {
          activities.push({
            activityType: ActivityType.PRIORITY,
            value: { field: 'priority', oldValue: prevSnapshot.priority, newValue: params.priority },
          });
        }
        if (params.status && prevSnapshot.statusV2 !== params.status) {
          activities.push({
            activityType: ActivityType.STATUS,
            value: { field: 'statusV2', oldValue: prevSnapshot.statusV2, newValue: params.status },
          });
        }
        if (params.eta) {
          const prevEtaMs = prevSnapshot.eta ? prevSnapshot.eta.getTime() : null;
          const nextEtaMs = new Date(params.eta).getTime();
          if (prevEtaMs !== nextEtaMs) {
            activities.push({
              activityType: ActivityType.ETA,
              value: { field: 'eta', oldValue: prevEtaMs, newValue: nextEtaMs },
            });
          }
        }
      }
      if (tagDiff.added.length > 0 || tagDiff.removed.length > 0) {
        activities.push({
          activityType: ActivityType.TAGS,
          value: { added: tagDiff.added, removed: tagDiff.removed },
        });
      }
      if (activities.length > 0) {
        await prisma.ticketActivity.createMany({
          data: activities.map(activity => ({
            ticketId,
            updatedBy: userId,
            workspaceId: updatedTicket.workspaceId,
            activityType: activity.activityType,
            value: activity.value,
          })),
        });
      }
    } catch (error) {
      logger.error(
        `[TicketService] Failed to write ticket activities for ticket ${ticketId}:`,
        error,
      );
    }

    await vespaQueue.addJob({
      schema: ticketSchema,
      jobType: 'feed',
      docId: updatedTicket.id,
      userId,
      workspaceId: updatedTicket.workspaceId,
    }).catch(error => {
      logger.error('[TicketService] Failed to queue Vespa feed after ticket update:', {
        ticketId: updatedTicket.id,
        error: error,
      });
    });
    const currentCountsSnapshot = await buildKanbanCountsSnapshot(updatedTicket.id);
    if (currentCountsSnapshot) {
      websocketService.broadcastTicketCountsUpdate({
        operation: 'update',
        ticket: currentCountsSnapshot,
        previousTicket: previousCountsSnapshot,
      });
    }

    logger.info(`[TicketService] Updated ticket ${ticketId}: ${updates.join(', ')}`);
    return updates;
  }

  /**
   * Replace the set of tags on a ticket with `tagNames`.
   * Mirrors the create-path write model: old `ticket_tags` table plus the
   * dual-write to `project_tags` + `ticket_tag_mappings`. Diff-based so we
   * only add/remove what actually changed, wrapped in a single transaction.
   */
  async updateTicketTags(
    ticketId: string,
    tagNames: string[],
  ): Promise<{ added: string[]; removed: string[] }> {
    const desired = Array.from(
      new Set(tagNames.map(t => t.trim()).filter(Boolean)),
    );

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { workspaceId: true },
    });

    const existing = await prisma.ticketTag.findMany({
      where: { ticketId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map(t => t.name));

    const toAdd = desired.filter(n => !existingNames.has(n));
    const toRemove = Array.from(existingNames).filter(n => !desired.includes(n));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { added: [], removed: [] };
    }

    await prisma.$transaction(async tx => {
      if (toRemove.length > 0) {
        await tx.ticketTag.deleteMany({
          where: { ticketId, name: { in: toRemove } },
        });
        for (const name of toRemove) {
          await dualDeleteTicketTag(ticketId, name, tx);
        }
      }
      if (toAdd.length > 0) {
        await tx.ticketTag.createMany({
          data: toAdd.map(name => ({ name, ticketId, workspaceId: ticket.workspaceId })),
        });
        await dualWriteTicketTags(ticketId, toAdd, tx);
      }
    });

    logger.info(
      `[TicketService] Updated tags for ticket ${ticketId}: +${toAdd.length} -${toRemove.length}`,
    );

    return { added: toAdd, removed: toRemove };
  }

  /**
   * Fetch and download all image attachments for a ticket
   * Converts them to Base64 format for use in vision-enabled AI workflows
   */
  async getImagesForTicket(ticketId: string): Promise<ImageAttachment[]> {
    try {
      const attachments = await this.messageAttachmentRepository.findByTicketId(ticketId);

      const imageAttachmentPromises = attachments
        .filter(a => a.mimetype.startsWith('image/'))
        .map(async (attachment, index): Promise<ImageAttachment | null> => {
          try {
            const buffer = await getStorageService().getFileBuffer(attachment.url);
            const rawFileName = attachment.url.split('/').pop() || `image-${index}`;
            const fileName = sanitizeFilename(rawFileName);
            return {
              id: `img-${index}-${Date.now()}`,
              type: 'image' as const,
              data: buffer.toString('base64'),
              mimeType: attachment.mimetype,
              name: fileName,
            };
          } catch (err) {
            logger.error('Failed to download image from GCS', { url: attachment.url, error: err });
            return null;
          }
        });

      const imageAttachmentsRaw = await Promise.all(imageAttachmentPromises);
      return imageAttachmentsRaw.filter((a): a is ImageAttachment => a !== null);
    } catch (error) {
      logger.error('Failed to fetch image attachments for ticket', { ticketId, error });
      return [];
    }
  }
}

// Export a singleton instance
export const ticketService = new TicketService();
