import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { jiraMigrationPreviewService } from '@/services/jiraMigrationPreviewService';
import {
  jiraMigrationImportService,
  type JiraMigrationExecuteInput,
  type JiraMigrationProgressUpdate,
  type JiraMigrationResolveUsersInput,
} from '@/services/jiraMigrationImportService';
import { jiraMigrationProgressService } from '@/services/jiraMigrationProgressService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { config } from '@/config/env';
import { getCachedJiraUserEmailMappings } from '@/services/jira/jiraUserMapCsv';
import { getCanvasUrl } from '@/services/canvasService';
import { messageMetadataService } from '@/services/messageMetadataService';
import { generateKeyBetween } from 'fractional-indexing';
import {
  queueJiraPurgeAttachmentVespaDeleteJob,
  queueJiraPurgeMessageVespaDeleteJob,
  queueJiraPurgeTicketVespaDeleteJob,
} from '@/services/jira/vespa';
import { runWithContext } from '@/database/tenant/context';

const db = DatabaseClient.getInstance();

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  return chunks;
};

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
};

export class JiraMigrationController {
  moveJiraProjectBoard = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const {
        jiraProjectKey,
        channelId,
        sourceBoardId,
        targetBoardId,
        tagNames,
        dryRun,
        confirmText,
      } = req.body as {
        jiraProjectKey?: string;
        channelId?: string;
        sourceBoardId?: string;
        targetBoardId?: string;
        tagNames?: string[];
        dryRun?: boolean;
        confirmText?: string;
      };

      if (!jiraProjectKey || !channelId || !sourceBoardId || !targetBoardId) {
        res.status(400).json({ error: 'jiraProjectKey, channelId, sourceBoardId, and targetBoardId are required' });
        return;
      }

      const normalizedProjectKey = jiraProjectKey.trim().toUpperCase();
      const normalizedTagNames = Array.from(
        new Set(
          (Array.isArray(tagNames) ? tagNames : [])
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(Boolean),
        ),
      );
      const resolvedDryRun = dryRun !== false;
      const resolvedConfirmText = (confirmText || '').trim();
      if (!resolvedDryRun && resolvedConfirmText !== `MOVE ${normalizedProjectKey}`) {
        res.status(400).json({ error: `Type 'MOVE ${normalizedProjectKey}' to confirm` });
        return;
      }

      if (sourceBoardId === targetBoardId) {
        res.status(400).json({ error: 'sourceBoardId and targetBoardId must be different' });
        return;
      }

      const externalSourceName = `jira-${normalizedProjectKey}-${channelId}`.toLowerCase();
      const externalSource = await db.externalSource.findUnique({
        where: { name: externalSourceName },
        select: { id: true, sourceType: true, boardId: true, channelId: true, name: true },
      });
      if (!externalSource || externalSource.sourceType !== 'jira') {
        res.status(404).json({ error: 'Jira external source not found for provided jiraProjectKey + channelId' });
        return;
      }

      const externalSourceBoardMismatch =
        Boolean(externalSource.boardId) && externalSource.boardId !== sourceBoardId;
      if (externalSourceBoardMismatch) {
        logger.warn('[JiraMigration] External source boardId does not match sourceBoardId; continuing with requested sourceBoardId', {
          externalSourceId: externalSource.id,
          externalSourceBoardId: externalSource.boardId,
          sourceBoardId,
          targetBoardId,
          channelId,
          jiraProjectKey: normalizedProjectKey,
        });
      }

      const [sourceBoard, targetBoard, channel] = await Promise.all([
        db.board.findUnique({ where: { id: sourceBoardId }, select: { id: true, projectId: true, name: true } }),
        db.board.findUnique({ where: { id: targetBoardId }, select: { id: true, projectId: true, name: true } }),
        db.channel.findUnique({ where: { id: channelId }, select: { id: true, projectId: true, name: true } }),
      ]);

      if (!sourceBoard || !targetBoard || !channel) {
        res.status(404).json({ error: 'sourceBoardId, targetBoardId, or channelId not found' });
        return;
      }
      if (sourceBoard.projectId !== targetBoard.projectId || channel.projectId !== targetBoard.projectId) {
        res.status(400).json({ error: 'Boards and channel must belong to same project' });
        return;
      }

      const ticketMappings = await db.externalMessage.findMany({
        where: {
          externalSourceId: externalSource.id,
          entityType: 'TICKET',
          entityId: { not: null },
        },
        select: { entityId: true },
      });
      const mappedTicketIds = ticketMappings.map(m => m.entityId!).filter(Boolean);
      if (mappedTicketIds.length === 0) {
        res.json({ success: true, data: { movedTickets: 0, dryRun: resolvedDryRun, missingStages: [] } });
        return;
      }

      const ticketsToMove = await db.ticket.findMany({
        where: {
          id: { in: mappedTicketIds },
          boardId: sourceBoardId,
          ...(normalizedTagNames.length > 0
            ? {
                tags: {
                  some: {
                    OR: normalizedTagNames.map(tagName => ({
                      name: { equals: tagName, mode: 'insensitive' as const },
                    })),
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          stageName: true,
          createdAt: true,
        },
      });

      const targetStages = await db.stage.findMany({
        where: { boardId: targetBoardId },
        select: { id: true, name: true, eta: true, sequenceNumber: true },
        orderBy: { sequenceNumber: 'asc' },
      });
      const targetStageByName = new Map(targetStages.map(s => [s.name, s]));
      const missingStages = Array.from(
        new Set(
          ticketsToMove
            .map(t => t.stageName)
            .filter(stageName => !targetStageByName.has(stageName)),
        ),
      );

      if (resolvedDryRun) {
        res.json({
          success: true,
          data: {
            dryRun: true,
            externalSourceId: externalSource.id,
            jiraProjectKey: normalizedProjectKey,
            channelId,
            sourceBoardId,
            targetBoardId,
            tagNames: normalizedTagNames,
            movedTickets: ticketsToMove.length,
            missingStages,
            ...(externalSourceBoardMismatch
              ? {
                  warnings: [
                    `External source boardId (${externalSource.boardId}) does not match sourceBoardId (${sourceBoardId}). Moving only the subset currently on sourceBoardId.`,
                  ],
                }
              : {}),
          },
        });
        return;
      }

      if (missingStages.length > 0) {
        const sourceStages = await db.stage.findMany({
          where: { boardId: sourceBoardId, name: { in: missingStages } },
          select: { name: true, eta: true, defaultTicketStatusV2: true, sequenceNumber: true },
        });
        const sourceStageByName = new Map(sourceStages.map(stage => [stage.name, stage]));
        const stillMissing = missingStages.filter(name => !sourceStageByName.has(name));
        if (stillMissing.length > 0) {
          res.status(400).json({
            error: 'Target board missing stages; source board also missing some stage definitions (cannot create)',
            missingStages: stillMissing,
          });
          return;
        }

        let currentMaxStageSequence = targetStages.reduce(
          (max, stage) => Math.max(max, stage.sequenceNumber),
          0,
        );
        const stagesToCreate = [];
        for (const stageName of missingStages) {
          const src = sourceStageByName.get(stageName)!;
          const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
            targetBoardId,
            currentMaxStageSequence,
          );
          currentMaxStageSequence = Math.max(currentMaxStageSequence, sequenceNumber);
          stagesToCreate.push({ stageName, src, sequenceNumber });
        }
        const created = await db.$transaction(
          stagesToCreate.map(({ stageName, src, sequenceNumber }) =>
            db.stage.create({
              data: {
                name: stageName,
                eta: src.eta ?? null,
                boardId: targetBoardId,
                // The shared counter is never lowered, even if the migration's
                // ordering pass below rewrites display sequence values.
                sequenceNumber,
                createdBy: actorUserId,
                defaultTicketStatusV2: src.defaultTicketStatusV2,
              },
              select: { id: true, name: true, eta: true, sequenceNumber: true },
            }),
          ),
        );
        for (const stage of created) {
          targetStages.push(stage);
          targetStageByName.set(stage.name, stage);
        }
      }

      // Align target board stage ordering with source board stage ordering (by stage name).
      // Stages not present on source board keep relative order at end.
      const [sourceStagesAll, targetStagesAll] = await Promise.all([
        db.stage.findMany({
          where: { boardId: sourceBoardId },
          select: { name: true, sequenceNumber: true },
          orderBy: { sequenceNumber: 'asc' },
        }),
        db.stage.findMany({
          where: { boardId: targetBoardId },
          select: { id: true, name: true, sequenceNumber: true },
          orderBy: { sequenceNumber: 'asc' },
        }),
      ]);
      const targetByName = new Map(targetStagesAll.map(stage => [stage.name, stage] as const));
      const seenTargetIds = new Set<string>();
      const desiredStageOrder: Array<{ id: string; name: string }> = [];

      for (const src of sourceStagesAll) {
        const match = targetByName.get(src.name);
        if (!match) continue;
        if (seenTargetIds.has(match.id)) continue;
        seenTargetIds.add(match.id);
        desiredStageOrder.push({ id: match.id, name: match.name });
      }

      for (const stage of targetStagesAll) {
        if (seenTargetIds.has(stage.id)) continue;
        seenTargetIds.add(stage.id);
        desiredStageOrder.push({ id: stage.id, name: stage.name });
      }

      // Reassign the existing sequence values in the desired order. This keeps
      // deletion gaps intact; newly allocated common-counter values naturally
      // extend the pool without resetting it to 1..N.
      const stageSequencePool = targetStagesAll
        .map(stage => stage.sequenceNumber)
        .sort((left, right) => left - right);
      const now = new Date();
      await db.$transaction(
        desiredStageOrder.map((stage, index) =>
          db.stage.update({
            where: { id: stage.id },
            data: {
              sequenceNumber: stageSequencePool[index]!,
              updatedBy: actorUserId,
              updatedAt: now,
            },
          }),
        ),
      );

      const byStage = new Map<string, Array<{ id: string; createdAt: Date }>>();
      for (const ticket of ticketsToMove) {
        const list = byStage.get(ticket.stageName) || [];
        list.push({ id: ticket.id, createdAt: ticket.createdAt });
        byStage.set(ticket.stageName, list);
      }

      // Compute all kanbanPosition updates up front so we can apply them in batches without holding a long transaction.
      const ticketUpdates: Array<{ ticketId: string; stageName: string; kanbanPosition: string }> =
        [];
      for (const [stageName, stageTickets] of byStage.entries()) {
        stageTickets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const firstTicketInStage = await db.ticket.findFirst({
          where: {
            boardId: targetBoardId,
            stageName,
            kanbanPosition: { not: null },
          },
          orderBy: { kanbanPosition: 'asc' },
          select: { kanbanPosition: true },
        });
        const stageKeyEnd = firstTicketInStage?.kanbanPosition ?? null;

        let prevKey: string | null = null;
        for (const ticket of stageTickets) {
          const nextKey = generateKeyBetween(prevKey, stageKeyEnd);
          prevKey = nextKey;
          ticketUpdates.push({ ticketId: ticket.id, stageName, kanbanPosition: nextKey });
        }
      }

      const UPDATES_PER_SECOND = 30;
      const updateBatches = chunkArray(ticketUpdates, UPDATES_PER_SECOND);
      for (let batchIndex = 0; batchIndex < updateBatches.length; batchIndex += 1) {
        const batch = updateBatches[batchIndex]!;

        await db.$transaction(async tx => {
          for (const update of batch) {
            await tx.ticket.update({
              where: { id: update.ticketId },
              data: {
                boardId: targetBoardId,
                kanbanPosition: update.kanbanPosition,
                updatedBy: actorUserId,
                updatedAt: now,
              },
            });
          }
        });

        if (batchIndex < updateBatches.length - 1) {
          await sleep(1000);
        }
      }

      // Update externalSource.boardId only if we fully drained the requested source board
      // (so we don't break future moves when tickets are split across boards).
      const remainingOnSource = await db.ticket.count({
        where: { id: { in: mappedTicketIds }, boardId: sourceBoardId },
      });
      if (remainingOnSource === 0 && (!externalSource.boardId || externalSource.boardId === sourceBoardId)) {
        await db.externalSource.update({
          where: { id: externalSource.id },
          data: { boardId: targetBoardId },
        });
      }

      res.json({
        success: true,
        data: {
          dryRun: false,
          externalSourceId: externalSource.id,
          jiraProjectKey: normalizedProjectKey,
          channelId,
          sourceBoardId,
          targetBoardId,
          tagNames: normalizedTagNames,
          movedTickets: ticketUpdates.length,
          missingStages: [],
          ...(externalSourceBoardMismatch
            ? {
                warnings: [
                  `External source boardId (${externalSource.boardId}) does not match sourceBoardId (${sourceBoardId}). Moved only the subset currently on sourceBoardId.`,
                ],
              }
            : {}),
        },
      });
    } catch (error) {
      logger.error('Jira migration move-jira-project-board failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to move Jira project tickets' });
    }
  };

  moveJiraProjectChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const {
        jiraProjectKey,
        sourceChannelId,
        targetChannelId,
        dryRun,
        confirmText,
      } = req.body as {
        jiraProjectKey?: string;
        sourceChannelId?: string;
        targetChannelId?: string;
        dryRun?: boolean;
        confirmText?: string;
      };

      if (!jiraProjectKey || !sourceChannelId || !targetChannelId) {
        res.status(400).json({ error: 'jiraProjectKey, sourceChannelId, and targetChannelId are required' });
        return;
      }

      if (sourceChannelId === targetChannelId) {
        res.status(400).json({ error: 'sourceChannelId and targetChannelId must be different' });
        return;
      }

      const normalizedProjectKey = jiraProjectKey.trim().toUpperCase();
      const resolvedDryRun = dryRun !== false;
      const resolvedConfirmText = (confirmText || '').trim();
      if (!resolvedDryRun && resolvedConfirmText !== `MOVE ${normalizedProjectKey}`) {
        res.status(400).json({ error: `Type 'MOVE ${normalizedProjectKey}' to confirm` });
        return;
      }

      const sourceExternalSourceName = `jira-${normalizedProjectKey}-${sourceChannelId}`.toLowerCase();
      const targetExternalSourceName = `jira-${normalizedProjectKey}-${targetChannelId}`.toLowerCase();

      const [sourceExternalSource, targetExternalSource, sourceChannel, targetChannel] = await Promise.all([
        db.externalSource.findUnique({
          where: { name: sourceExternalSourceName },
          select: { id: true, sourceType: true, channelId: true, boardId: true, name: true },
        }),
        db.externalSource.findUnique({
          where: { name: targetExternalSourceName },
          select: { id: true, sourceType: true, channelId: true, boardId: true, name: true },
        }),
        db.channel.findUnique({
          where: { id: sourceChannelId },
          select: { id: true, name: true, projectId: true, workspaceId: true },
        }),
        db.channel.findUnique({
          where: { id: targetChannelId },
          select: { id: true, name: true, projectId: true, workspaceId: true },
        }),
      ]);

      if (!sourceExternalSource || sourceExternalSource.sourceType !== 'jira') {
        res.status(404).json({ error: 'Jira external source not found for provided jiraProjectKey + sourceChannelId' });
        return;
      }

      if (!sourceChannel || !targetChannel) {
        res.status(404).json({ error: 'sourceChannelId or targetChannelId not found' });
        return;
      }

      if (sourceChannel.projectId !== targetChannel.projectId) {
        res.status(400).json({ error: 'Source and target channels must belong to the same project' });
        return;
      }

      if (sourceChannel.workspaceId !== targetChannel.workspaceId) {
        res.status(400).json({ error: 'Source and target channels must belong to the same workspace' });
        return;
      }

      if (targetExternalSource && targetExternalSource.id !== sourceExternalSource.id) {
        res.status(409).json({
          error: 'A Jira external source already exists for the target channel + project key',
        });
        return;
      }

      const ticketMappings = await db.externalMessage.findMany({
        where: {
          externalSourceId: sourceExternalSource.id,
          entityType: 'TICKET',
          entityId: { not: null },
        },
        select: { entityId: true },
      });
      const mappedTicketIds = ticketMappings.map(mapping => mapping.entityId!).filter(Boolean);

      if (mappedTicketIds.length === 0) {
        res.json({
          success: true,
          data: {
            dryRun: resolvedDryRun,
            jiraProjectKey: normalizedProjectKey,
            sourceChannelId,
            targetChannelId,
            movedTickets: 0,
            movedConversations: 0,
            movedParticipants: 0,
            externalSourceUpdated: false,
          },
        });
        return;
      }

      const ticketsToMove = await db.ticket.findMany({
        where: {
          id: { in: mappedTicketIds },
          channelId: sourceChannelId,
        },
        select: {
          id: true,
          conversationId: true,
        },
      });

      const conversationIds = Array.from(
        new Set(
          ticketsToMove
            .map(ticket => ticket.conversationId)
            .filter((conversationId): conversationId is string => Boolean(conversationId)),
        ),
      );

      const [conversationCount, participantCount] = await Promise.all([
        conversationIds.length > 0
          ? db.conversation.count({
              where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
            })
          : Promise.resolve(0),
        conversationIds.length > 0
          ? db.conversationParticipant.count({
              where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
            })
          : Promise.resolve(0),
      ]);

      const remainingOnSourceBeforeMove = mappedTicketIds.length - ticketsToMove.length;
      const wouldFullyDrainSource = remainingOnSourceBeforeMove === 0;

      if (resolvedDryRun) {
        res.json({
          success: true,
          data: {
            dryRun: true,
            externalSourceId: sourceExternalSource.id,
            jiraProjectKey: normalizedProjectKey,
            sourceChannelId,
            sourceChannelName: sourceChannel.name,
            targetChannelId,
            targetChannelName: targetChannel.name,
            movedTickets: ticketsToMove.length,
            movedConversations: conversationCount,
            movedParticipants: participantCount,
            externalSourceUpdated: wouldFullyDrainSource,
            warnings: [
              ...(wouldFullyDrainSource
                ? []
                : [
                    `Only ${ticketsToMove.length} of ${mappedTicketIds.length} Jira-mapped tickets are currently on sourceChannelId. External source will stay on ${sourceChannelId} until the remaining ${remainingOnSourceBeforeMove} ticket(s) are moved.`,
                  ]),
            ],
          },
        });
        return;
      }

      const now = new Date();
      const result = await db.$transaction(async tx => {
        const ticketUpdate = await tx.ticket.updateMany({
          where: {
            id: { in: ticketsToMove.map(ticket => ticket.id) },
            channelId: sourceChannelId,
          },
          data: {
            channelId: targetChannelId,
            updatedBy: actorUserId,
            updatedAt: now,
          },
        });

        const conversationUpdateCount =
          conversationIds.length > 0
            ? (
                await tx.conversation.updateMany({
                  where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
                  data: { channelId: targetChannelId, workspaceId: targetChannel.workspaceId ?? null },
                })
              ).count
            : 0;

        const participantUpdateCount =
          conversationIds.length > 0
            ? (
                await tx.conversationParticipant.updateMany({
                  where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
                  data: { channelId: targetChannelId },
                })
              ).count
            : 0;

        const remainingOnSource = await tx.ticket.count({
          where: {
            id: { in: mappedTicketIds },
            channelId: sourceChannelId,
          },
        });

        let externalSourceUpdated = false;
        if (remainingOnSource === 0) {
          await tx.externalSource.update({
            where: { id: sourceExternalSource.id },
            data: {
              name: targetExternalSourceName,
              channelId: targetChannelId,
            },
          });
          externalSourceUpdated = true;
        }

        return {
          ticketUpdateCount: ticketUpdate.count,
          conversationUpdateCount,
          participantUpdateCount,
          remainingOnSource,
          externalSourceUpdated,
        };
      });

      res.json({
        success: true,
        data: {
          dryRun: false,
          externalSourceId: sourceExternalSource.id,
          jiraProjectKey: normalizedProjectKey,
          sourceChannelId,
          sourceChannelName: sourceChannel.name,
          targetChannelId,
          targetChannelName: targetChannel.name,
          movedTickets: result.ticketUpdateCount,
          movedConversations: result.conversationUpdateCount,
          movedParticipants: result.participantUpdateCount,
          externalSourceUpdated: result.externalSourceUpdated,
          ...(result.remainingOnSource > 0
            ? {
                warnings: [
                  `Moved ${result.ticketUpdateCount} ticket(s), but ${result.remainingOnSource} Jira-mapped ticket(s) still point at ${sourceChannelId}. External source remains on the source channel until those are moved.`,
                ],
              }
            : {}),
        },
      });
    } catch (error) {
      logger.error('Jira migration move-jira-project-channel failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to move Jira project tickets to another channel' });
    }
  };

  moveChannelProject = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const { channelId, sourceProjectId, targetProjectId, updatedAt } = req.body as {
        channelId?: string;
        sourceProjectId?: string;
        targetProjectId?: string;
        updatedAt?: string;
      };

      if (!channelId || !sourceProjectId || !targetProjectId) {
        res.status(400).json({ error: 'channelId, sourceProjectId, and targetProjectId are required' });
        return;
      }

      if (sourceProjectId === targetProjectId) {
        res.status(400).json({ error: 'sourceProjectId and targetProjectId must be different' });
        return;
      }

      const resolvedUpdatedAt = updatedAt ? new Date(updatedAt) : new Date();
      if (Number.isNaN(resolvedUpdatedAt.getTime())) {
        res.status(400).json({ error: 'updatedAt must be a valid ISO datetime string' });
        return;
      }

      const result = await db.channel.updateMany({
        where: { id: channelId, projectId: sourceProjectId },
        data: { projectId: targetProjectId, isMigrated: true, updatedAt: resolvedUpdatedAt },
      });

      if (result.count === 0) {
        res.status(404).json({
          error: 'Channel not found for the provided channelId + sourceProjectId (no updates applied)',
        });
        return;
      }

      const updatedChannel = await db.channel.findUnique({
        where: { id: channelId },
        select: { id: true, projectId: true, isMigrated: true, updatedAt: true, name: true, project: { select: { name: true } } },
      });

      logger.info('analytics_event', {
        event: 'channel_migrated',
        timestamp: new Date().toISOString(),
        channelId,
        channelName: updatedChannel?.name ?? null,
        channelProjectName: updatedChannel?.project?.name ?? null,
        sourceType: 'jira',
      });

      res.json({ success: true, data: { updatedCount: result.count, channel: updatedChannel } });
    } catch (error) {
      logger.error('Jira migration channel move failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to move channel projectId' });
    }
  };

  changeTicketCreatedBy = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const { ticketId, newCreatedByUserId, updatedAt } = req.body as {
        ticketId?: string; // accepts Ticket.id or Ticket.xyneId
        newCreatedByUserId?: string;
        updatedAt?: string;
        cascadeConversationAndMessages?: boolean;
      };

      if (!ticketId || !newCreatedByUserId) {
        res.status(400).json({ error: 'ticketId and newCreatedByUserId are required' });
        return;
      }

      const resolvedUpdatedAt = updatedAt ? new Date(updatedAt) : new Date();
      if (Number.isNaN(resolvedUpdatedAt.getTime())) {
        res.status(400).json({ error: 'updatedAt must be a valid ISO datetime string' });
        return;
      }

      const userExists = await db.user.findUnique({ where: { id: newCreatedByUserId }, select: { id: true } });
      if (!userExists) {
        res.status(404).json({ error: 'newCreatedByUserId user not found' });
        return;
      }

      const cascade = Boolean((req.body as { cascadeConversationAndMessages?: boolean })?.cascadeConversationAndMessages);

      const existingTicket = await db.ticket.findFirst({
        where: { OR: [{ id: ticketId }, { xyneId: ticketId }] },
        select: { id: true, xyneId: true, conversationId: true, createdBy: true },
      });
      if (!existingTicket) {
        res.status(404).json({ error: 'Ticket not found (no updates applied)' });
        return;
      }

      const result = await db.$transaction(async tx => {
        const ticketUpdate = await tx.ticket.updateMany({
          where: { id: existingTicket.id },
          data: { createdBy: newCreatedByUserId, updatedBy: actorUserId, updatedAt: resolvedUpdatedAt },
        });

        let conversationUpdatedCount = 0;
        let messageUpdatedCount = 0;
        let attachmentUpdatedCount = 0;

        if (cascade) {
          const convUpdate = await tx.conversation.updateMany({
            where: { conversationId: existingTicket.conversationId, createdBy: existingTicket.createdBy },
            data: { createdBy: newCreatedByUserId },
          });
          conversationUpdatedCount = convUpdate.count;

          const msgUpdate = await tx.message.updateMany({
            where: { conversationId: existingTicket.conversationId, senderId: existingTicket.createdBy },
            data: { senderId: newCreatedByUserId },
          });
          messageUpdatedCount = msgUpdate.count;

          const attachUpdate = await tx.messageAttachment.updateMany({
            where: { conversationId: existingTicket.conversationId, createdBy: existingTicket.createdBy },
            data: { createdBy: newCreatedByUserId, uploadedByUserId: newCreatedByUserId },
          });
          attachmentUpdatedCount = attachUpdate.count;
        }

        return { ticketUpdate, conversationUpdatedCount, messageUpdatedCount, attachmentUpdatedCount };
      });

      if (result.ticketUpdate.count === 0) {
        res.status(404).json({ error: 'Ticket not found (no updates applied)' });
        return;
      }

      const updatedTicket = await db.ticket.findFirst({
        where: { id: existingTicket.id },
        select: { id: true, createdBy: true, updatedBy: true, updatedAt: true, xyneId: true, title: true, projectId: true, channelId: true },
      });

      res.json({
        success: true,
        data: {
          updatedCount: result.ticketUpdate.count,
          ticket: updatedTicket,
          cascadeConversationAndMessages: cascade,
          conversationUpdatedCount: result.conversationUpdatedCount,
          messageUpdatedCount: result.messageUpdatedCount,
          attachmentUpdatedCount: result.attachmentUpdatedCount,
        },
      });
    } catch (error) {
      logger.error('Jira migration change ticket createdBy failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to change ticket createdBy' });
    }
  };

  purgeProjectMigration = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const { projectId, confirmText, dryRun, externalSourceId, jiraProjectKey } = req.body as {
        projectId?: string;
        confirmText?: string;
        dryRun?: boolean;
        externalSourceId?: string;
        jiraProjectKey?: string;
      };

      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }

      if (!externalSourceId && !jiraProjectKey) {
        res.status(400).json({ error: 'externalSourceId or jiraProjectKey is required to scope the purge to a specific Jira migration' });
        return;
      }

      const isDryRun = dryRun !== false;
      if (!isDryRun) {
        const expectedConfirm = `DELETE ${projectId}`;
        if (!confirmText || confirmText.trim() !== expectedConfirm) {
          res.status(400).json({ error: `confirmText must exactly equal '${expectedConfirm}'` });
          return;
        }
      }

      const channels = await db.channel.findMany({
        where: { projectId },
        select: { id: true },
      });
      const channelIds = channels.map(c => c.id);

      const normalizedJiraProjectKey = jiraProjectKey?.trim().toUpperCase();
      const externalSources = await db.externalSource.findMany({
        where: {
          sourceType: 'jira',
          ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
          ...(externalSourceId
            ? { id: externalSourceId }
            : normalizedJiraProjectKey
              ? { displayName: { contains: normalizedJiraProjectKey, mode: 'insensitive' } }
              : {}),
        },
        select: { id: true, name: true, channelId: true, displayName: true },
      });

      if (externalSources.length === 0) {
        res.status(404).json({
          error: 'No Jira migration source found for this project with the given externalSourceId/jiraProjectKey',
        });
        return;
      }
      const externalSourceIds = externalSources.map(s => s.id);

      const externalMessages = externalSourceIds.length
        ? await db.externalMessage.findMany({
            where: { externalSourceId: { in: externalSourceIds } },
            select: { id: true, entityType: true, entityId: true },
          })
        : [];

      const ticketIds = Array.from(
        new Set(
          externalMessages
            .filter(m => m.entityType === 'TICKET' && typeof m.entityId === 'string' && m.entityId.length > 0)
            .map(m => m.entityId as string),
        ),
      );

      const tickets = ticketIds.length
        ? await db.ticket.findMany({
            where: { id: { in: ticketIds } },
            select: { id: true, conversationId: true },
          })
        : [];
      const conversationIds = Array.from(new Set(tickets.map(t => t.conversationId).filter(Boolean))) as string[];

      const messageIds = Array.from(
        new Set(
          externalMessages
            .filter(m => m.entityType === 'MESSAGE' && typeof m.entityId === 'string' && m.entityId.length > 0)
            .map(m => m.entityId as string),
        ),
      );

      const attachmentIds = Array.from(
        new Set(
          externalMessages
            .filter(m => m.entityType === 'ATTACHMENT' && typeof m.entityId === 'string' && m.entityId.length > 0)
            .map(m => m.entityId as string),
        ),
      );

      const stats = {
        projectId,
        jiraProjectKey: normalizedJiraProjectKey ?? externalSources[0]?.displayName ?? null,
        externalSourceIds,
        channelCount: channelIds.length,
        jiraExternalSourceCount: externalSources.length,
        externalMessageCount: externalMessages.length,
        ticketCount: ticketIds.length,
        conversationCount: conversationIds.length,
        mappedMessageCount: messageIds.length,
        mappedAttachmentCount: attachmentIds.length,
      };

      if (isDryRun) {
        res.json({ success: true, data: { dryRun: true, stats, externalSources } });
        return;
      }

      const jobId = randomUUID();
      await jiraMigrationProgressService.createPurgeJob(jobId, projectId, {
        externalMessageCount: externalMessages.length,
        ticketCount: ticketIds.length,
        messageCount: messageIds.length,
        attachmentCount: attachmentIds.length,
        conversationCount: conversationIds.length,
      });

      res.json({ success: true, data: { jobId, stats } });

      void this.runPurgeJob(jobId, projectId, {
        actorUserId,
        externalSourceIds,
        externalMessageCount: externalMessages.length,
        messageIds,
        conversationIds,
        attachmentIds,
        ticketIds,
        stats,
      });
    } catch (error) {
      logger.error('Jira migration purge project failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to purge project migration' });
    }
  };

  private async runPurgeJob(
    jobId: string,
    projectId: string,
    data: {
      actorUserId: string;
      externalSourceIds: string[];
      externalMessageCount: number;
      messageIds: string[];
      conversationIds: string[];
      attachmentIds: string[];
      ticketIds: string[];
      stats: Record<string, unknown>;
    },
  ): Promise<void> {
    const { actorUserId, externalSourceIds, externalMessageCount, messageIds, conversationIds, attachmentIds, ticketIds, stats } = data;

    try {
      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'running',
        currentStep: 'purging_external_mappings',
      });

      let processedUnits = 0;
      let deletedExternalMessages = 0;
      let deletedMessages = 0;
      let deletedAttachments = 0;
      let deletedTickets = 0;

      const phase1ExternalSourceChunkSize = 500;
      const phase1MessageChunkSize = 1000;
      const phase1ConversationChunkSize = 100;
      const phase1AttachmentChunkSize = 1000;
      const ticketChunkSize = 50;
      const ticketChunkDelayMs = 1000;

      // Phase 1a: external mappings.
      if (externalSourceIds.length) {
        const chunks = chunkArray(externalSourceIds, phase1ExternalSourceChunkSize);
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;
          const result = await db.externalMessage.deleteMany({ where: { externalSourceId: { in: chunk } } });
          deletedExternalMessages += result.count;
        }
      }

      processedUnits += externalMessageCount;
      await jiraMigrationProgressService.patchJob(jobId, { processedIssues: processedUnits });

      await jiraMigrationProgressService.patchJob(jobId, { currentStep: 'purging_reactions' });

      // Phase 1b: reactions tied to Jira comment messages.
      if (messageIds.length) {
        const chunks = chunkArray(messageIds, phase1MessageChunkSize);
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;
          const [, , , attachmentResult, messageResult] = await db.$transaction([
            db.reactionCount.deleteMany({ where: { messageId: { in: chunk } } }),
            db.reaction.deleteMany({ where: { messageId: { in: chunk } } }),
            db.messageSearch.deleteMany({ where: { messageId: { in: chunk } } }),
            db.messageAttachment.deleteMany({ where: { entityId: { in: chunk } } }),
            db.message.deleteMany({ where: { messageId: { in: chunk } } }),
          ]);
          deletedAttachments += attachmentResult.count;
          deletedMessages += messageResult.count;

          // Best-effort: remove messages from Vespa search index.
          for (const messageId of chunk) {
            queueJiraPurgeMessageVespaDeleteJob(messageId, actorUserId);
          }

          processedUnits += chunk.length;
          await jiraMigrationProgressService.patchJob(jobId, { processedIssues: processedUnits });
        }
      }

      await jiraMigrationProgressService.patchJob(jobId, { currentStep: 'purging_conversations' });

      // Phase 1c: conversation graph.
      if (conversationIds.length) {
        const chunks = chunkArray(conversationIds, phase1ConversationChunkSize);
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;
          await db.$transaction(async tx => {
            await tx.conversationParticipant.deleteMany({ where: { conversationId: { in: chunk } } });
            await tx.messageAttachment.deleteMany({ where: { conversationId: { in: chunk } } });
            await tx.message.deleteMany({ where: { conversationId: { in: chunk } } });
            await tx.conversation.deleteMany({ where: { conversationId: { in: chunk } } });
          });
        }
      }

      processedUnits += conversationIds.length;
      await jiraMigrationProgressService.patchJob(jobId, { processedIssues: processedUnits });

      // Phase 1d: defensive attachment cleanup.
      if (attachmentIds.length) {
        const chunks = chunkArray(attachmentIds, phase1AttachmentChunkSize);
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;

          // Delete by attachment row id. We intentionally do NOT require conversationIds here because
          // comment attachments may exist even when conversationIds cannot be resolved.
          const attachmentResult = await db.messageAttachment.deleteMany({
            where: { id: { in: chunk } },
          });
          deletedAttachments += attachmentResult.count;

          // Best-effort: remove attachments from Vespa search index.
          for (const attachmentId of chunk) {
            queueJiraPurgeAttachmentVespaDeleteJob(attachmentId, actorUserId);
          }

          processedUnits += chunk.length;
          await jiraMigrationProgressService.patchJob(jobId, { processedIssues: processedUnits });
        }
      }

      await jiraMigrationProgressService.patchJob(jobId, { currentStep: 'purging_tickets' });

      // Phase 2: ticket-related deletes in chunks with throttle.
      const ticketChunks = chunkArray(ticketIds, ticketChunkSize);
      for (let index = 0; index < ticketChunks.length; index += 1) {
        const chunk = ticketChunks[index];
        if (chunk.length === 0) continue;

        const ticketTxnResults = await db.$transaction([
          db.ticketReferenceMapping.deleteMany({
            where: { OR: [{ sourceTicketId: { in: chunk } }, { targetTicketId: { in: chunk } }] },
          }),
          db.ticketActivity.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketAssignment.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketEntityMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketTag.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketTagMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketStageEta.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketStageRequest.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticketSubTicketMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.subTicket.updateMany({ where: { mappedTicketId: { in: chunk } }, data: { mappedTicketId: null } }),
          db.formEntityValues.deleteMany({ where: { entityId: { in: chunk }, entityType: 'TICKET' } }),
          db.emailRead.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.workflow.deleteMany({ where: { ticketId: { in: chunk } } }),
          db.ticket.deleteMany({ where: { id: { in: chunk } } }),
        ]);
        const ticketDeleteResult = ticketTxnResults[ticketTxnResults.length - 1];
        deletedTickets += ticketDeleteResult.count;

        // Best-effort: remove tickets from Vespa search index so UI/search doesn't show stale results.
        for (const ticketId of chunk) {
          queueJiraPurgeTicketVespaDeleteJob(ticketId, actorUserId);
        }

        processedUnits += chunk.length;
        await jiraMigrationProgressService.patchJob(jobId, {
          processedIssues: processedUnits,
        });

        if (index < ticketChunks.length - 1) {
          await sleep(ticketChunkDelayMs);
        }
      }

      await jiraMigrationProgressService.patchJob(jobId, { currentStep: 'purging_sources' });

      // Phase 3: remove Jira external sources last.
      if (externalSourceIds.length) {
        await db.externalSource.deleteMany({ where: { id: { in: externalSourceIds } } });
      }

      const remainingExternalMessageCount = externalSourceIds.length
        ? await db.externalMessage.count({ where: { externalSourceId: { in: externalSourceIds } } })
        : 0;
      const remainingTicketCount = ticketIds.length ? await db.ticket.count({ where: { id: { in: ticketIds } } }) : 0;
      const remainingMessageCount = messageIds.length
        ? await db.message.count({ where: { messageId: { in: messageIds } } })
        : 0;
      const remainingAttachmentCount = attachmentIds.length
        ? await db.messageAttachment.count({ where: { id: { in: attachmentIds } } })
        : 0;

      if (
        remainingExternalMessageCount > 0 ||
        remainingTicketCount > 0 ||
        remainingMessageCount > 0 ||
        remainingAttachmentCount > 0
      ) {
        const errorMessage = `Purge incomplete: remaining externalMessages=${remainingExternalMessageCount} tickets=${remainingTicketCount} messages=${remainingMessageCount} attachments=${remainingAttachmentCount}`;
        logger.error('[JiraMigration] Purge job completed with leftovers', {
          jobId,
          projectId,
          errorMessage,
          deletedExternalMessages,
          deletedTickets,
          deletedMessages,
          deletedAttachments,
        });
        await jiraMigrationProgressService.patchJob(jobId, {
          status: 'failed',
          currentStep: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage,
          processedIssues: processedUnits,
        });
        return;
      }

      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'completed',
        currentStep: 'completed',
        completedAt: new Date().toISOString(),
        processedIssues: processedUnits,
        importedTickets: ticketIds.length,
      });

      logger.info('[JiraMigration] Purge job completed', { jobId, projectId, stats });
    } catch (error) {
      logger.error('[JiraMigration] Background purge job failed', error, { jobId, projectId });
      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown purge error',
      });
    }
  };

  userMapLookup = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration operations' });
        return;
      }

      const { accountId } = req.body as { accountId?: string };
      if (!accountId || !accountId.trim()) {
        res.status(400).json({ error: 'accountId is required' });
        return;
      }

      const mappings = await getCachedJiraUserEmailMappings();
      const key = `accountId:${accountId.trim()}`.toLowerCase();
      const mappedEmail = mappings[key] || null;

      res.json({
        success: true,
        data: {
          location: (config.jira.migrationUserMapCsvLocation || '').trim() || null,
          rows: Object.keys(mappings).length,
          accountId: accountId.trim(),
          key,
          mappedEmail,
        },
      });
    } catch (error) {
      logger.error('Jira migration user map lookup failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to lookup user map' });
    }
  };

  preview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey, targetProjectId, targetBoardId, targetChannelId } = req.body as {
        jiraProjectKey?: string;
        targetProjectId?: string;
        targetBoardId?: string;
        targetChannelId?: string;
        issueKeys?: string[];
        jiraBoardId?: number;
        nextPageToken?: string;
        maxResults?: number;
        dateFrom?: string;
        filters?: { reporterAccountIds?: string[]; creatorAccountIds?: string[]; assigneeAccountIds?: string[]; labels?: string[]; epicKeys?: string[] };
        loadFilterOptions?: boolean;
      };

      if (!jiraProjectKey || !targetProjectId || !targetBoardId || !targetChannelId) {
        res.status(400).json({
          error: 'jiraProjectKey, targetProjectId, targetBoardId, and targetChannelId are required',
        });
        return;
      }

      const result = await jiraMigrationPreviewService.preview({
        jiraProjectKey,
        targetProjectId,
        targetBoardId,
        targetChannelId,
        issueKeys: Array.isArray(req.body.issueKeys)
          ? req.body.issueKeys.filter((value: unknown): value is string => typeof value === 'string')
          : undefined,
        ...(typeof req.body.jiraBoardId === 'number' ? { jiraBoardId: req.body.jiraBoardId } : {}),
        nextPageToken: req.body.nextPageToken,
        maxResults: req.body.maxResults,
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
        loadFilterOptions: req.body.loadFilterOptions === true,
        filters: req.body.filters && typeof req.body.filters === 'object' ? {
          ...(Array.isArray(req.body.filters.reporterAccountIds) ? { reporterAccountIds: req.body.filters.reporterAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.creatorAccountIds) ? { creatorAccountIds: req.body.filters.creatorAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.assigneeAccountIds) ? { assigneeAccountIds: req.body.filters.assigneeAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.labels) ? { labels: req.body.filters.labels.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.epicKeys) ? { epicKeys: req.body.filters.epicKeys.filter((value: unknown): value is string => typeof value === 'string') } : {}),
        } : undefined,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Jira migration preview failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview Jira migration',
      });
    }
  };

  resolveUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey } = req.body as { jiraProjectKey?: string };
      if (!jiraProjectKey) {
        res.status(400).json({ error: 'jiraProjectKey is required' });
        return;
      }

      const input: JiraMigrationResolveUsersInput = {
        jiraProjectKey,
        issueKeys: Array.isArray(req.body.issueKeys) ? req.body.issueKeys : undefined,
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
        includeComments: req.body.includeComments !== false,
        includeAttachments: req.body.includeAttachments !== false,
        nextPageToken: typeof req.body.nextPageToken === 'string' ? req.body.nextPageToken : null,
        pageSize: typeof req.body.pageSize === 'number' ? req.body.pageSize : undefined,
        userEmailMappings:
          req.body.userEmailMappings && typeof req.body.userEmailMappings === 'object' && !Array.isArray(req.body.userEmailMappings)
            ? (req.body.userEmailMappings as Record<string, string>)
            : undefined,
      };

      const result = await jiraMigrationImportService.resolveUsers(input);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Jira migration resolve-users failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to resolve Jira users' });
    }
  };

  execute = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey, targetProjectId, targetBoardId, targetChannelId } = req.body as {
        jiraProjectKey?: string;
        targetProjectId?: string;
        targetBoardId?: string;
        targetChannelId?: string;
        issueKeys?: string[];
        jiraBoardId?: number;
        dateFrom?: string;
        statusV2Mappings?: Record<string, string>;
        skipCustomFieldIds?: string[];
        jiraStatusSequence?: string[];
        excludedStageNames?: string[];
        filters?: { reporterAccountIds?: string[]; creatorAccountIds?: string[]; assigneeAccountIds?: string[]; labels?: string[]; epicKeys?: string[] };
        userEmailMappings?: Record<string, string>;
      };

      if (!jiraProjectKey || !targetProjectId || !targetBoardId || !targetChannelId) {
        res.status(400).json({
          error: 'jiraProjectKey, targetProjectId, targetBoardId, and targetChannelId are required',
        });
        return;
      }

      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration' });
        return;
      }

      const input: JiraMigrationExecuteInput = {
        jiraProjectKey,
        targetProjectId,
        targetBoardId,
        targetChannelId,
        issueKeys: Array.isArray(req.body.issueKeys) ? req.body.issueKeys : undefined,
        ...(typeof req.body.jiraBoardId === 'number' ? { jiraBoardId: req.body.jiraBoardId } : {}),
        ...(typeof req.body.jiraBoardName === 'string' ? { jiraBoardName: req.body.jiraBoardName } : {}),
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
        filters: req.body.filters && typeof req.body.filters === 'object' ? {
          ...(Array.isArray(req.body.filters.reporterAccountIds) ? { reporterAccountIds: req.body.filters.reporterAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.creatorAccountIds) ? { creatorAccountIds: req.body.filters.creatorAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.assigneeAccountIds) ? { assigneeAccountIds: req.body.filters.assigneeAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.labels) ? { labels: req.body.filters.labels.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.epicKeys) ? { epicKeys: req.body.filters.epicKeys.filter((value: unknown): value is string => typeof value === 'string') } : {}),
        } : undefined,
        statusV2Mappings:
          req.body.statusV2Mappings && typeof req.body.statusV2Mappings === 'object'
            ? req.body.statusV2Mappings
            : {},
        skipCustomFieldIds: Array.isArray(req.body.skipCustomFieldIds)
          ? req.body.skipCustomFieldIds.filter((fieldId: unknown): fieldId is string => typeof fieldId === 'string')
          : [],
        jiraStatusSequence: Array.isArray(req.body.jiraStatusSequence)
          ? req.body.jiraStatusSequence.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : undefined,
        excludedStageNames: Array.isArray(req.body.excludedStageNames)
          ? req.body.excludedStageNames.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : undefined,
        userEmailMappings:
          req.body.userEmailMappings && typeof req.body.userEmailMappings === 'object' && !Array.isArray(req.body.userEmailMappings)
            ? (req.body.userEmailMappings as Record<string, string>)
            : undefined,
      };

      if (Object.keys(input.statusV2Mappings).length === 0) {
        res.status(400).json({
          error: 'statusV2Mappings is required and must include Jira status to StatusV2 mappings',
        });
        return;
      }

      const jobId = randomUUID();
      await jiraMigrationProgressService.createJob(jobId, input);

      res.json({ success: true, data: { jobId } });

      void this.runMigrationJob(jobId, input, actorUserId);
    } catch (error) {
      logger.error('Jira migration execution failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to execute Jira migration',
      });
    }
  };

  bulkExecute = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration' });
        return;
      }

      const jobsRaw = (req.body as { jobs?: unknown }).jobs;
      if (!Array.isArray(jobsRaw) || jobsRaw.length === 0) {
        res.status(400).json({ error: 'jobs is required and must be a non-empty array' });
        return;
      }

      const jobs: JiraMigrationExecuteInput[] = [];
      for (const item of jobsRaw) {
        if (!item || typeof item !== 'object') {
          res.status(400).json({ error: 'Each job must be an object' });
          return;
        }
        const job = item as Partial<JiraMigrationExecuteInput> & Record<string, unknown>;
        if (!job.jiraProjectKey || !job.targetProjectId || !job.targetBoardId || !job.targetChannelId) {
          res.status(400).json({
            error: 'Each job must include jiraProjectKey, targetProjectId, targetBoardId, and targetChannelId',
          });
          return;
        }
        if (!job.statusV2Mappings || typeof job.statusV2Mappings !== 'object' || Array.isArray(job.statusV2Mappings)) {
          res.status(400).json({ error: 'Each job must include statusV2Mappings' });
          return;
        }
        if (Object.keys(job.statusV2Mappings as Record<string, string>).length === 0) {
          res.status(400).json({ error: 'Each job must include non-empty statusV2Mappings' });
          return;
        }

        jobs.push(job as JiraMigrationExecuteInput);
      }

      const startedJobs = await Promise.all(
        jobs.map(async input => {
          const jobId = randomUUID();
          await jiraMigrationProgressService.createJob(jobId, input);
          return {
            jobId,
            jiraProjectKey: input.jiraProjectKey.trim().toUpperCase(),
            jiraBoardId: input.jiraBoardId ?? null,
            jiraBoardName: input.jiraBoardName ?? null,
            targetProjectId: input.targetProjectId,
            targetBoardId: input.targetBoardId,
            targetChannelId: input.targetChannelId,
          };
        }),
      );

      res.json({ success: true, data: { jobs: startedJobs } });

      // Run sequentially to avoid hammering Jira API / DB.
      void (async () => {
        for (let index = 0; index < jobs.length; index += 1) {
          const input = jobs[index];
          const started = startedJobs[index];
          if (!input || !started) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            await this.runMigrationJob(started.jobId, input, actorUserId);
          } catch (error) {
            logger.error('Jira migration bulk execution failed for job', error, {
              jobId: started.jobId,
              jiraProjectKey: input.jiraProjectKey,
              jiraBoardId: input.jiraBoardId,
              targetBoardId: input.targetBoardId,
            });
            // Ensure a terminal state even if runMigrationJob throws unexpectedly.
            // eslint-disable-next-line no-await-in-loop
            await jiraMigrationProgressService.patchJob(started.jobId, {
              status: 'failed',
              currentStep: 'failed',
              currentIssueKey: null,
              completedAt: new Date().toISOString(),
              errorMessage: error instanceof Error ? error.message : 'Bulk migration failed',
            });
          }
        }
      })();
    } catch (error) {
      logger.error('Jira migration bulk execution failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to bulk execute Jira migration',
      });
    }
  };

  status = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };

      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      res.json({ success: true, data: job });
    } catch (error) {
      logger.error('Jira migration status fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Jira migration status',
      });
    }
  };

  stop = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.status !== 'running' && job.status !== 'queued') {
        res.status(400).json({ error: `Job cannot be stopped (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'cancel_requested' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration stop failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to stop Jira migration' });
    }
  };

  pause = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.controlStatus === 'cancel_requested') {
        res.status(400).json({ error: 'Job is already stopped' });
        return;
      }

      if (job.status !== 'running') {
        res.status(400).json({ error: `Job is not running (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'paused', currentStep: 'paused' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration pause failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to pause Jira migration' });
    }
  };

  resume = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.controlStatus === 'cancel_requested') {
        res.status(400).json({ error: 'Job is already stopped' });
        return;
      }

      if (job.status !== 'running') {
        res.status(400).json({ error: `Job is not running (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'running' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration resume failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to resume Jira migration' });
    }
  };


  boards = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectKey = (req.query.projectKey as string || '').trim().toUpperCase();
      if (!projectKey) {
        res.status(400).json({ error: 'projectKey query param is required' });
        return;
      }
      const boards = await jiraMigrationPreviewService.fetchProjectBoards(projectKey);
      res.json({ success: true, data: boards });
    } catch (error) {
      logger.error('Jira migration boards fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Jira boards',
      });
    }
  };

  deleteJiraMigratedStageEta = async (req: Request, res: Response): Promise<void> => {
    try {
      const { dryRun, externalSourceId } = req.body as {
        dryRun?: boolean;
        externalSourceId?: string;
      };

      const resolvedDryRun = dryRun !== false;

      logger.info(`[JIRA-MIGRATION] deleteJiraMigratedStageEta started — dryRun=${resolvedDryRun}${externalSourceId ? ` externalSourceId=${externalSourceId}` : ' (all sources)'}`);

      // Find ticket IDs imported from Jira via external_messages
      const jiraTicketMappings = await db.externalMessage.findMany({
        where: {
          entityType: 'TICKET',
          entityId: { not: null },
          ...(externalSourceId ? { externalSourceId } : {}),
        },
        select: { entityId: true },
        distinct: ['entityId'],
      });

      const jiraTicketIds = jiraTicketMappings
        .map(r => r.entityId)
        .filter((id): id is string => id !== null);

      const toDeleteCount = await db.ticketStageEta.count({
        where: { ticketId: { in: jiraTicketIds } },
      });

      logger.info(`[JIRA-MIGRATION] Found ${jiraTicketIds.length} Jira-migrated tickets, ${toDeleteCount} stageEta entries to delete`);

      if (resolvedDryRun) {
        res.json({
          success: true,
          dryRun: true,
          jiraMigratedTickets: jiraTicketIds.length,
          stageEtaEntriesToDelete: toDeleteCount,
          message: 'Dry run — pass dryRun: false to apply',
        });
        return;
      }

      const stageEtaEntries = await db.ticketStageEta.findMany({
        where: { ticketId: { in: jiraTicketIds } },
        select: { id: true },
      });

      let deleted = 0;
      const DELETES_PER_SECOND = 50;
      const DELETE_INTERVAL_MS = 1000;
      const deletesPerInterval = Math.max(
        1,
        Math.floor((DELETES_PER_SECOND * DELETE_INTERVAL_MS) / 1000),
      );
      const deleteChunks = chunkArray(
        stageEtaEntries.map(entry => entry.id),
        deletesPerInterval,
      );

      for (let index = 0; index < deleteChunks.length; index += 1) {
        const batch = deleteChunks[index];
        if (batch.length === 0) continue;

        const result = await db.ticketStageEta.deleteMany({
          where: { id: { in: batch } },
        });
        deleted += result.count;

        logger.info(`[JIRA-MIGRATION] Progress: ${deleted}/${toDeleteCount} stageEta entries deleted (batch ${index + 1}/${deleteChunks.length})`);

        if (index < deleteChunks.length - 1) {
          await sleep(DELETE_INTERVAL_MS);
        }
      }

      logger.info(`[JIRA-MIGRATION] Done — deleted ${deleted} stageEta entries for ${jiraTicketIds.length} Jira-migrated tickets`);

      res.json({
        success: true,
        dryRun: false,
        jiraMigratedTickets: jiraTicketIds.length,
        stageEtaEntriesDeleted: deleted,
      });
    } catch (error) {
      logger.error('deleteJiraMigratedStageEta failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete stage ETA entries',
      });
    }
  };

  history = async (_req: Request, res: Response): Promise<void> => {
    try {
      const history = (await db.externalSource.findMany({
        where: { sourceType: 'jira' },
        orderBy: { updatedAt: 'desc' },
      })).map(source => {
        const jiraProjectKeyMatch = source.displayName.match(/Jira \((.+)\)/i);

        return {
          externalSourceId: source.id,
          jiraProjectKey: jiraProjectKeyMatch?.[1] || source.displayName.replace(/^Jira\s*\(|\)$/g, ''),
          displayName: source.displayName,
          targetBoardId: source.boardId || null,
          targetChannelId: source.channelId,
          isActive: source.isActive,
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
        };
      });

      res.json({ success: true, data: history });
    } catch (error) {
      logger.error('Jira migration history fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Jira migration history',
      });
    }
  };

  private async runMigrationJob(
    jobId: string,
    input: JiraMigrationExecuteInput,
    actorUserId: string,
  ): Promise<void> {
    // Fire-and-forget background job detached from the HTTP request (no req.user), so open an
    // explicit tenant scope from the import's TARGET workspace (single-target import) so the
    // workspaceId stamper fills the rows this job writes downstream.
    const targetChannel = await db.channel.findUnique({
      where: { id: input.targetChannelId },
      select: { workspaceId: true },
    });
    const workspaceId = targetChannel?.workspaceId || config.defaultWorkspaceId;

    await runWithContext({ userId: actorUserId, workspaceId }, async () => {
      try {
        await jiraMigrationProgressService.patchJob(jobId, {
          status: 'running',
          controlStatus: 'running',
          currentStep: 'starting',
          currentIssueKey: null,
        });

        const result = await jiraMigrationImportService.execute(
          input,
          actorUserId,
          async (update: JiraMigrationProgressUpdate) => {
            await this.handleProgressUpdate(jobId, update);
          },
          async () => (await jiraMigrationProgressService.getJob(jobId))?.controlStatus,
        );

        await jiraMigrationProgressService.patchJob(jobId, {
          status: 'completed',
          currentStep: 'completed',
          currentIssueKey: null,
          completedAt: new Date().toISOString(),
          result,
          warnings: result.warnings,
          issueResults: result.issueResults,
          totalIssues: result.issueResults.length,
          processedIssues: result.issueResults.length,
          importedTickets: result.importedTickets,
          skippedTickets: result.skippedTickets,
          importedComments: result.importedComments,
          skippedComments: result.skippedComments,
          importedAttachments: result.importedAttachments,
          skippedAttachments: result.skippedAttachments,
        });

        try {
          await this.postMigrationReport(input.targetChannelId, actorUserId, result);
        } catch (reportError) {
          logger.error('[JiraMigration] Failed to post migration report to channel', reportError, {
            jobId,
            channelId: input.targetChannelId,
            jiraProjectKey: result.jiraProjectKey,
          });
        }
      } catch (error) {
        logger.error('[JiraMigration] Background migration job failed', error, { jobId });
        await jiraMigrationProgressService.patchJob(jobId, {
          status: 'failed',
          currentStep: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : 'Unknown migration error',
        });
      }
    });
  }

  private getMigrationReportSummary(result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult) {
    return {
      completedIssues: result.issueResults.filter(issue => issue.status === 'completed').length,
      partialIssues: result.issueResults.filter(issue => issue.status === 'partial').length,
      failedIssues: result.issueResults.filter(issue => issue.status === 'failed').length,
    };
  }

  private buildMetricCard(label: string, value: string, tone: 'default' | 'success' | 'warning' | 'danger' = 'default') {
    const backgroundColorByTone = {
      default: '#F8FAFC',
      success: '#ECFDF5',
      warning: '#FFFBEB',
      danger: '#FEF2F2',
    } as const;

    const textColorByTone = {
      default: '#0F172A',
      success: '#065F46',
      warning: '#92400E',
      danger: '#991B1B',
    } as const;

    return {
      id: randomUUID(),
      type: 'paragraph',
      props: {
        backgroundColor: backgroundColorByTone[tone],
        textColor: textColorByTone[tone],
      },
      content: [
        { type: 'text', text: `${label}\n`, styles: { bold: true } },
        { type: 'text', text: value, styles: { textColor: textColorByTone[tone] } },
      ],
    };
  }

  private buildBulletListBlock(title: string, items: string[]) {
    if (items.length === 0) {
      return [];
    }

    return [
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: title, styles: {} }],
      },
      ...items.map(item => ({
        id: randomUUID(),
        type: 'bulletListItem',
        content: [{ type: 'text', text: item, styles: {} }],
      })),
    ];
  }

  private buildMigrationReportCanvasBlocks(
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ) {
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const topWarnings = result.warnings;
    const unresolvedUserItems = result.unresolvedUsers.map(user => {
      const name = user.displayName || user.accountId || 'Unknown Jira user';
      const suggestedEmails = user.suggestedEmails.length > 0 ? user.suggestedEmails.join(', ') : null;
      const issueKeys = user.issueKeys.length > 0 ? user.issueKeys.join(', ') : null;

      return [
        name,
        suggestedEmails,
        issueKeys ? `Tickets: ${issueKeys}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    });
    const issueDetailItems = result.issueResults
      .filter(issue => issue.status !== 'completed')
      .map(issue => {
        const base = `${issue.issueKey} · ${issue.status.toUpperCase()}${issue.failedStep ? ` · ${issue.failedStep}` : ''} · ${issue.summary}`;
        return issue.errors.length > 0
          ? `${base} · ${issue.errors.join(' | ')}`
          : base;
      });

    return [
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: `Jira Migration Report · ${result.jiraProjectKey}`, styles: {} }],
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: 'Execution summary for the latest Jira import run.', styles: {} }],
      },
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Overview', styles: {} }],
      },
      this.buildMetricCard('Tickets', `${result.importedTickets} imported · ${result.skippedTickets} skipped`, 'success'),
      this.buildMetricCard('Comments', `${result.importedComments} imported · ${result.skippedComments} skipped`),
      this.buildMetricCard('Attachments', `${result.importedAttachments} imported · ${result.skippedAttachments} skipped`),
      this.buildMetricCard('Custom Fields', `${result.createdBoardCustomFields} created · ${result.reusedBoardCustomFields} reused`),
      this.buildMetricCard(
        'Issue Status',
        `${completedIssues} completed · ${partialIssues} partial · ${failedIssues} failed`,
        failedIssues > 0 ? 'danger' : partialIssues > 0 ? 'warning' : 'success',
      ),
      this.buildMetricCard('Relationships', `${result.linkedTickets} links · ${result.createdSubTickets} subtickets`),
      ...this.buildBulletListBlock(
        topWarnings.length > 0
          ? `Warnings${result.warnings.length > topWarnings.length ? ` (showing ${topWarnings.length} of ${result.warnings.length})` : ''}`
          : 'Warnings',
        topWarnings,
      ),
      ...this.buildBulletListBlock(
        unresolvedUserItems.length > 0
          ? `Unresolved Users${result.unresolvedUsers.length > unresolvedUserItems.length ? ` (showing ${unresolvedUserItems.length} of ${result.unresolvedUsers.length})` : ''}`
          : 'Unresolved Users',
        unresolvedUserItems,
      ),
      ...this.buildBulletListBlock(
        issueDetailItems.length > 0
          ? `Issue Details${result.issueResults.filter(issue => issue.status !== 'completed').length > issueDetailItems.length ? ` (showing ${issueDetailItems.length})` : ''}`
          : 'Issue Details',
        issueDetailItems,
      ),
    ];
  }

  private async createMigrationReportCanvas(
    channelId: string,
    actorUserId: string,
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ): Promise<string> {
    const now = new Date();
    const canvasId = randomUUID();
    const participantId = randomUUID();
    try {
      await db.$transaction(async tx => {
        await tx.canvas.create({
          data: {
            id: canvasId,
            title: `Jira Migration Report: ${result.jiraProjectKey}`,
            content: this.buildMigrationReportCanvasBlocks(result) as any,
            channelId,
            createdBy: actorUserId,
            visibility: 'PUBLIC',
            isTemplate: false,
            isCollaborative: false,
            lastEditedBy: actorUserId,
            lastEditedAt: now,
            createdAt: now,
            updatedAt: now,
            metadata: {
              source: 'jira_migration_report',
              jiraProjectKey: result.jiraProjectKey,
              externalSourceId: result.externalSourceId || null,
              summary: {
                importedTickets: result.importedTickets,
                skippedTickets: result.skippedTickets,
                importedComments: result.importedComments,
                importedAttachments: result.importedAttachments,
                warnings: result.warnings.length,
                ...this.getMigrationReportSummary(result),
              },
            },
          },
        });

        await tx.canvasParticipant.create({
          data: {
            id: participantId,
            canvasId,
            userId: actorUserId,
            role: 'OWNER',
            joinedAt: now,
            updatedAt: now,
          },
        });
      });
    } catch (error) {
      logger.error('[JiraMigration] Canvas report create failed', error, {
        jiraProjectKey: result.jiraProjectKey,
        externalSourceId: result.externalSourceId || null,
        channelId,
        actorUserId,
        canvasId,
      });
      throw error;
    }

    const canvasUrl = getCanvasUrl(canvasId);
    logger.info('[JiraMigration] Canvas report created', {
      jiraProjectKey: result.jiraProjectKey,
      externalSourceId: result.externalSourceId || null,
      channelId,
      actorUserId,
      canvasId,
      canvasUrl,
    });

    return canvasUrl;
  }

  private async postMigrationReport(
    channelId: string,
    actorUserId: string,
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ): Promise<void> {
    const reportCanvasChannelId =
      (config.jiraMigration as any).reportCanvasChannelId &&
      String((config.jiraMigration as any).reportCanvasChannelId).trim()
        ? String((config.jiraMigration as any).reportCanvasChannelId).trim()
        : channelId;

    // Post the summary message only to the report canvas channel.
    channelId = reportCanvasChannelId;
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const now = new Date();
    let canvasUrl: string | null = null;
    try {
      canvasUrl = await this.createMigrationReportCanvas(
        reportCanvasChannelId,
        actorUserId,
        result,
      );
    } catch (error) {
      logger.error('[JiraMigration] Canvas report failed; posting summary message without canvas link', error, {
        channelId: reportCanvasChannelId,
        actorUserId,
        jiraProjectKey: result.jiraProjectKey,
        externalSourceId: result.externalSourceId || null,
      });
    }
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const messageContent = [
      `Jira migration report · ${result.jiraProjectKey}`,
      '',
      `Tickets: ${result.importedTickets} imported · ${result.skippedTickets} skipped`,
      `Comments: ${result.importedComments} imported · ${result.skippedComments} skipped`,
      `Attachments: ${result.importedAttachments} imported · ${result.skippedAttachments} skipped`,
      `Issue status: ${completedIssues} completed · ${partialIssues} partial · ${failedIssues} failed`,
      `Warnings: ${result.warnings.length}`,
      ...(canvasUrl ? ['', `View full report: ${canvasUrl}`] : []),
    ].join('\n');

    const migrationReportChannel = await db.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });

    await db.$transaction(async tx => {
      await tx.conversation.create({
        data: {
          conversationId,
          channelId,
          createdBy: actorUserId,
          initialMessageId: messageId,
          ...(migrationReportChannel?.workspaceId ? { workspaceId: migrationReportChannel.workspaceId } : {}),
          createdAt: now,
          lastActivityAt: now,
          metadata: {
            source: {
              system: 'jira',
              kind: 'migration_report',
              jiraProjectKey: result.jiraProjectKey,
              canvasUrl,
            },
          },
        },
      });

      await tx.message.create({
        data: {
          messageId,
          conversationId,
          senderId: actorUserId,
          ...(migrationReportChannel?.workspaceId ? { workspaceId: migrationReportChannel.workspaceId } : {}),
          content: messageContent,
          msgType: 'SYSTEM',
          hasAttachment: false,
          showInChannel: true,
          metadata: {
            messageSubtype: 'jira_migration_report',
            jiraProjectKey: result.jiraProjectKey,
            externalSourceId: result.externalSourceId || null,
            canvasUrl,
            summary: {
              importedTickets: result.importedTickets,
              skippedTickets: result.skippedTickets,
              importedComments: result.importedComments,
              importedAttachments: result.importedAttachments,
              warnings: result.warnings.length,
              completedIssues,
              partialIssues,
              failedIssues,
            },
          },
          createdAt: now,
        },
      });

      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId: actorUserId,
          },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId: actorUserId,
          participationType: 'AUTHOR',
          isSubscribed: true,
          joinedAt: now,
          channelId,
        },
        update: {
          participationType: 'AUTHOR',
          isSubscribed: true,
        },
      });

      await tx.channel.update({
        where: { id: channelId },
        data: { lastActivityAt: now },
      });
    });
    await messageMetadataService.syncInitialMessageMd(conversationId);

  }

  private async handleProgressUpdate(
    jobId: string,
    update: JiraMigrationProgressUpdate,
  ): Promise<void> {
    await jiraMigrationProgressService.patchJob(jobId, {
      status: 'running',
      totalIssues: update.totalIssues,
      processedIssues: update.processedIssues,
      importedTickets: update.importedTickets,
      skippedTickets: update.skippedTickets,
      importedComments: update.importedComments,
      skippedComments: update.skippedComments,
      importedAttachments: update.importedAttachments,
      skippedAttachments: update.skippedAttachments,
      currentIssueKey: update.currentIssueKey,
      currentStep: update.currentStep,
      stageSequence: update.stageSequence,
      warnings: update.warnings,
    });

    // Stop controls (checked between progress ticks)
    const job = await jiraMigrationProgressService.getJob(jobId);
    if (job?.controlStatus === 'cancel_requested') {
      throw new Error('Migration stopped by user');
    }

    if (update.issueResult) {
      await jiraMigrationProgressService.upsertIssueResult(jobId, update.issueResult);
    }
  }
}
