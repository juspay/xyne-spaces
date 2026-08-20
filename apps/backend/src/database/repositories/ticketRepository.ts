import { Prisma, PrismaClient } from '@prisma/client';
import { extractEmailAddress } from '@/utils/email';
import { CreateTicketRequest, ActivitySource } from '../../types/ticket';
import { websocketService } from '@/services/websocketService';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { calculateETADeadline } from '@/utils/etaCalculation';
import {
  BaseTicketType,
  isReleaseTicket,
  PRActivityValue,
  TicketStatusV2,
  TicketPriority,
  ActivityType,
  PRStatusEvent,
  EmailType,
  parseTicketEtaManagement,
  mergeTicketEtaManagement,
  parseBoardEtaManagement,
} from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { generateKeyBetween } from 'fractional-indexing';
import { eventRouter } from '@/automations/engine/event-router';
import { TICKET_CREATED_EVENT } from '@/automations/triggers/ticket-created.trigger';
import {
  emitTicketUpdated,
  type TicketChanges,
  type FormFieldChanges,
} from '@/automations/triggers/ticket-updated.trigger';
import { versionReleaseMappingService } from '@/services/release/versionReleaseMappingService';
import { dualWriteTicketTag, dualWriteTicketTags } from '@/services/ticketTagDualWriteService';
import type { TicketLike } from '@/automations/triggers/ticket-context';
import { dispatchCommittedTicketStatusChange } from '@/services/flowStatusChangeDispatcher';
import { updateWhileFlowRunActive } from '@/services/flowActiveRunGuard';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import {
  resolveStepEstimate,
  loadBoardEtaContext,
  evaluateEta,
  buildEtaActivityIntents,
  isTerminalStatus,
  isEtaManagementKillSwitchActive,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  writeEtaActivitiesPrisma,
} from '@/services/etaManagement';
//import { queueTicketIngestion } from '@/queues/vespaQueue';

const prisma = DatabaseClient.getInstance();

// Type for Prisma transaction client
type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const makeFallbackCountsSnapshot = (ticket: {
  id: string;
  workspaceId: string;
  boardId: string | null;
  projectId: string | null;
  stageName: string;
  statusV2: TicketStatusV2;
  priority: TicketPriority;
  assignedTo: string | null;
  createdBy: string;
  userGroupId: string | null;
  ticketType: string | null;
  isStageOverdue?: boolean | null;
  eta: Date | null;
  createdAt: Date;
}) => ({
  id: ticket.id,
  workspaceId: ticket.workspaceId,
  boardId: ticket.boardId,
  projectId: ticket.projectId,
  stageName: ticket.stageName,
  statusV2: ticket.statusV2,
  priority: ticket.priority,
  assignedTo: ticket.assignedTo,
  createdBy: ticket.createdBy,
  userGroupId: ticket.userGroupId,
  ticketType: ticket.ticketType,
  isStageOverdue: ticket.isStageOverdue ?? false,
  eta: ticket.eta?.getTime() ?? null,
  createdAt: ticket.createdAt.getTime(),
  prReviewers: [],
  qaAssigned: [],
  roleAssignments: [],
});

export class TicketRepository {

  /**
   * Create a ticket (repository method - database access only)
   * NOTE: For creating tickets with conversations, use TicketService.createTicketWithConversation()
   * This method expects conversationId and xyneId to be provided
   * @param data - Ticket data
   * @param tx - Optional transaction client for atomic operations
   */
  async createTicket(
    data: CreateTicketRequest & {
      xyneId: string;
      createdBy: string;
      updatedBy: string;
      formFieldChanges?: FormFieldChanges;
    },
    tx?: PrismaTransaction,
  ) {
    const db = tx || prisma; // Use transaction if provided, else default prisma

    // Validate required fields
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }

    if (!data.xyneId) {
      throw new Error('xyneId is required');
    }

    if (!data.boardId) {
      throw new Error('boardId is required');
    }

    if (!data.channelId) {
      throw new Error('channelId is required');
    }

    // Fetch all stages of the board
    const stages = await db.stage.findMany({
      where: {
        boardId: data.boardId
      },
      orderBy: {
        sequenceNumber: 'asc'
      }
    });

    if (!stages || stages.length === 0) {
      throw new Error(`No stages found for board ${data.boardId}. Board must have at least one stage.`);
    }

    // Get the stage - use provided stageName if it exists in stages, otherwise use first stage
    let selectedStage = stages[0]; // Default to first stage

    if (data.stageName) {
      const foundStage = stages.find(stage => stage.name === data.stageName);
      if (foundStage) {
        selectedStage = foundStage;
      }
    }

    // New ticket at top of its column: position before the current first ticket
    const firstTicketInStage = await db.ticket.findFirst({
      where: {
        boardId: data.boardId,
        stageName: selectedStage.name,
        kanbanPosition: { not: null },
      },
      orderBy: { kanbanPosition: 'asc' },
      select: { kanbanPosition: true },
    });
    let kanbanPosition: string;
    try {
      kanbanPosition = generateKeyBetween(null, firstTicketInStage?.kanbanPosition ?? null);
    } catch {
      kanbanPosition = generateKeyBetween(null, null);
    }

    // Upsert merchant if merchantId is provided
    if (data.merchantId) {
      await db.merchant.upsert({
        where: { mid: data.merchantId },
        update: {}, // No update needed if exists
        create: {
          mid: data.merchantId,
        }
      });
      logger.info(`[TicketRepository] Upserted merchant with mid: ${data.merchantId}`);
    }

    // Ticket creation + initial stage visit + the ETA domain-service evaluation must commit atomically.
    // Reuses the caller's transaction when one was passed in; otherwise opens its own.
    const runCreate = async (client: PrismaTransaction | PrismaClient) => {
      const board = await client.board.findUnique({ where: { id: data.boardId } });
      if (!board) {
        throw new Error(`Board ${data.boardId} not found`);
      }
      const transitions = await client.stageTransition.findMany({ where: { boardId: data.boardId } });
      const boardEtaManagement = parseBoardEtaManagement(board.metadata);

      // Create ticket with the conversationId, auto-assigned stageName. `eta` is set here
      // only when the caller explicitly provided one (e.g. migration) An automatic initial due date, when the board has opted in, is set
      // by the domain-service evaluation below instead of a naive stage-sum here.
      const ticket = await client.ticket.create({
        data: {
          ...(data.id && { id: data.id }),
          title: data.title,
          description: data.description,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          assignedTo: data.assignedTo,
          // Non-null: validated by the `if (!data.conversationId) throw` guard above: TS
          // narrowing doesn't cross into this nested closure's captured `data` reference.
          conversationId: data.conversationId!,
          ...(data.sourceMessageId && { messageId: data.sourceMessageId }),
          channelId: data.channelId!,
          xyneId: data.xyneId,
          projectId: data.projectId,
          workspaceId: data.workspaceId,
          userGroupId: data.userGroupId,
          boardId: data.boardId,
          stageName: selectedStage.name,
          statusV2: data.statusV2 || TicketStatusV2.TODO,
          priority: data.priority || TicketPriority.LOW,
          ...(data.eta && { eta: data.eta }),
          metadata: data.metadata as Prisma.InputJsonValue,
          ...(data.rootId && { rootId: data.rootId }),
          closedAt: data.closedAt,
          closedBy: data.closedBy,
          merchantId: data.merchantId,
          ticketType: data.ticketType,
          kanbanPosition,
          ...(data.createdAt && { createdAt: data.createdAt }),
          lastEmailAt: data.createdAt ?? new Date(),
        }
      });

      const stageEnteredAt = new Date();
      let stageVisitId: string | null = null;
      let stageEtaDeadline: Date | null = null;
      // Only create TicketStageEta entry if the selected stage has ETA
      if (!data.skipStageEta && selectedStage.eta !== null && selectedStage.eta > 0) {
        stageEtaDeadline = calculateETADeadline(stageEnteredAt, selectedStage.eta);
        const stageEtaRow = await client.ticketStageEta.create({
          data: {
            ticketId: ticket.id,
            workspaceId: ticket.workspaceId,
            stageId: selectedStage.id,
            stageEnteredAt: stageEnteredAt,
            stageLeftAt: null,
            stageEta: stageEtaDeadline,
            updatedBy: data.createdBy,
          }
        });
        stageVisitId = stageEtaRow.id;
      }

      const stepEstimate = resolveStepEstimate(
        { id: selectedStage.id, eta: selectedStage.eta },
        null,
        { requireExplicitTransition: false },
      );
      const etaResult = evaluateEta({
        ticketId: ticket.id,
        ticketStatus: ticket.statusV2,
        isTerminal: isTerminalStatus(ticket.statusV2),
        currentTicketEta: ticket.eta,
        currentTicketEtaManagement: parseTicketEtaManagement(ticket.metadata),
        boardType: board.boardType,
        boardEtaManagement,
        currentStageId: selectedStage.id,
        stages,
        transitions,
        activeVisit: {
          stageVisitId,
          transitionId: null,
          deadline: stageEtaDeadline,
          deadlineTracked: stageVisitId !== null,
          estimateSource: stepEstimate.source,
          estimateHours: stepEstimate.incomplete ? null : stepEstimate.hours,
        },
        trigger: 'CREATE',
        now: stageEnteredAt,
        globalKillSwitchEnabled: isEtaManagementKillSwitchActive(),
      });

      const mergedMetadata = mergeTicketEtaManagement(ticket.metadata, etaResult.ticketEtaManagementPatch);
      const finalTicket = await client.ticket.update({
        where: { id: ticket.id },
        data: {
          ...(etaResult.etaDecision.changed && etaResult.etaDecision.newEta
            ? { eta: etaResult.etaDecision.newEta }
            : {}),
          metadata: mergedMetadata as Prisma.InputJsonValue,
        },
      });

      const activityIntents = buildEtaActivityIntents(etaResult, {
        currentStageId: selectedStage.id,
        oldEta: ticket.eta ? ticket.eta.getTime() : null,
        boardConfigVersion: boardEtaManagement.configVersion,
        trigger: 'CREATE',
        systemReason: 'Automatic ETA set on ticket creation',
        previousRiskFingerprint: null,
      });
      await writeEtaActivitiesPrisma(client as Prisma.TransactionClient, activityIntents, {
        ticketId: ticket.id,
        workspaceId: ticket.workspaceId,
        channelId: ticket.channelId,
        timestamp: stageEnteredAt.getTime(),
      });

      return { finalTicket, etaResult };
    };

    const createResult = tx
      ? await runCreate(tx)
      : await prisma.$transaction((innerTx) => runCreate(innerTx));
    const ticket = createResult.finalTicket;

    // Post-commit notification dispatch - best-effort, must never affect the already-
    // committed response. suppressed if the ticket was created already paused.
    if (ticket.statusV2 !== TicketStatusV2.PAUSED) {
      void dispatchEtaNotifications(etaSignalsFromResult(createResult.etaResult), {
        ticketId: ticket.id,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        ticketUserGroupId: ticket.userGroupId,
        boardId: ticket.boardId,
        actorId: data.createdBy,
      }).catch(error => {
        logger.error('[TicketRepository] Failed to dispatch ETA notifications', { ticketId: ticket.id, error });
      });
    }

    const isHotFix = ticket.ticketType === BaseTicketType.Hotfix
    // If it's a hotfix, add 'hotfix' tag to the ticket
    if (isHotFix) {
      await db.ticketTag.create({
        data: {
          ticketId: ticket.id,
          workspaceId: ticket.workspaceId,
          name: 'hotfix'
        }
      })
      await dualWriteTicketTag(ticket.id, 'hotfix');
      logger.info(`Hotfix tag added to ticket ${ticket.id}`);
    }
    const createdSnapshot = (await buildKanbanCountsSnapshot(ticket.id)) ?? makeFallbackCountsSnapshot(ticket as Parameters<typeof makeFallbackCountsSnapshot>[0]);
    websocketService.broadcastTicketCountsUpdate({
      operation: 'insert',
      ticket: createdSnapshot,
    });


    void (async (): Promise<void> => {
      try {
        await eventRouter.emit(
          {
            type: TICKET_CREATED_EVENT,
            payload: {
              ticketId: ticket.id,
              formFieldChanges: data.formFieldChanges,
              performedBy: { id: data.createdBy },
            },
          },
          ticket.workspaceId,
        );
      } catch (err) {
        logger.error(`[automations] TICKET_CREATED emit failed for ticket ${ticket.id}:`, err);
      }
    })();

    return ticket;
  }

  /**
   * Update ticket stage
   * @param ticketId - The ticket ID to update
   * @param newStageName - The new stage name
   * @param updatedBy - User ID who triggered the update
   * @param source - Source of the update (INTERNAL or WEBHOOK)
   * @param prActivityData - Optional PR activity data (only used when source is WEBHOOK)
   */
  async updateTicketStage(
    ticketId: string,
    newStageName: string,
    updatedBy: string,
    source: ActivitySource = ActivitySource.INTERNAL,
    prActivityData?: {
      prEvent: PRStatusEvent;
      prId: number;
      prUrl: string;
      repoName: string;
      sourceBranchName: string;
      destinationBranchName: string;
      prAuthor?: string;
      remainingOpenPRs?: number;
    },
    options: {
      cascadeFlow?: boolean;
      allowedCurrentStatuses?: readonly TicketStatusV2[];
      requiredActiveFlowRootId?: string;
    } = {},
  ) {

    // Get current ticket to capture old stage name, boardId, and statusV2
    const currentTicket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        workspaceId: true,
        projectId: true,
        stageName: true,
        boardId: true,
        statusV2: true,
        conversationId: true,
        channelId: true,
        priority: true,
        assignedTo: true,
        createdBy: true,
        userGroupId: true,
        ticketType: true,
        eta: true,
        createdAt: true,
        metadata: true,
      }
    });

    if (!currentTicket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const oldStageName = currentTicket.stageName;
    const oldStatusV2 = currentTicket.statusV2 as TicketStatusV2;
    const stageChanged = oldStageName !== newStageName;

    // Fetch current and target stages to determine movement direction
    const [currentStage, targetStage] = await Promise.all([
      prisma.stage.findFirst({
        where: { boardId: currentTicket.boardId, name: oldStageName },
        select: { id: true, sequenceNumber: true, defaultTicketStatusV2: true }
      }),
      prisma.stage.findFirst({
        where: { boardId: currentTicket.boardId, name: newStageName },
        select: { id: true, sequenceNumber: true, defaultTicketStatusV2: true, eta: true }
      })
    ]);

    if (!targetStage) {
      throw new Error(`Target stage "${newStageName}" not found in board ${currentTicket.boardId}`);
    }

    const newStatusV2 = targetStage.defaultTicketStatusV2 as TicketStatusV2;
    const statusChanged = newStatusV2 !== oldStatusV2;
    let guardedUpdatedTicket = null;
    if (options.allowedCurrentStatuses) {
      if (!options.allowedCurrentStatuses.includes(oldStatusV2)) return null;
      try {
        const update = (client: Prisma.TransactionClient | PrismaClient) =>
          client.ticket.update({
            where: {
              id: ticketId,
              statusV2: oldStatusV2,
              stageName: oldStageName,
            },
            data: {
              stageName: newStageName,
              statusV2: newStatusV2,
              updatedBy: updatedBy,
              updatedAt: new Date(),
            },
          });
        guardedUpdatedTicket = options.requiredActiveFlowRootId
          ? await updateWhileFlowRunActive({
              runTransaction: operation => prisma.$transaction(operation),
              lockAndReadRootStatus: async tx => {
                const [root] = await tx.$queryRaw<{ statusV2: TicketStatusV2 }[]>`
                  SELECT "statusV2"
                  FROM "tickets"
                  WHERE "id" = ${options.requiredActiveFlowRootId}
                  FOR UPDATE
                `;
                return root?.statusV2 ?? null;
              },
              update,
            })
          : await update(prisma);
        if (!guardedUpdatedTicket) return null;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          return null;
        }
        throw error;
      }
    }

    const isForwardMovement = !currentStage || targetStage.sequenceNumber > currentStage.sequenceNumber;
    const now = new Date();
    // Resolved outside the transaction: a stable bot-user lookup, not part of the
    // transactional state, and best kept off the held connection.
    const systemActorId = await getTicketBotActorId(currentTicket.workspaceId);

    // Everything below that mutates TicketStageEta, the ticket row (stage/status/eta/
    // metadata), and TicketActivity rows must commit atomically - previously this ran as a
    // sequence of separately-awaited, unguarded writes
    const txResult = await prisma.$transaction(async (tx) => {
      if (isForwardMovement) {
        // FORWARD MOVEMENT: Mark old stage as left, create/reactivate new stage entry

        // 1. Mark current stage as left (if exists)
        if (currentStage) {
          await tx.ticketStageEta.updateMany({
            where: {
              ticketId: ticketId,
              stageId: currentStage.id,
              stageLeftAt: null // Only update active entry
            },
            data: {
              stageLeftAt: now,
              updatedAt: now,
              updatedBy: updatedBy
            }
          });
        }

        // 2. Check if target stage entry already exists (re-entry case)
        const existingEntry = await tx.ticketStageEta.findFirst({
          where: {
            ticketId: ticketId,
            stageId: targetStage.id
          }
        });

        if (existingEntry) {
          // Re-entering a stage - reactivate it
          await tx.ticketStageEta.update({
            where: { id: existingEntry.id },
            data: {
              stageEnteredAt: now, // Update entered time to now
              stageLeftAt: null, // Mark as active
              updatedAt: now,
              updatedBy: updatedBy
            }
          });
        } else {
          // First time entering this stage - create new entry only if stage has ETA
          if (targetStage.eta !== null && targetStage.eta > 0) {

            const stageEtaDeadline = calculateETADeadline(now, targetStage.eta);

            await tx.ticketStageEta.create({
              data: {
                ticketId: ticketId,
                workspaceId: currentTicket.workspaceId,
                stageId: targetStage.id,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: stageEtaDeadline,
                updatedBy: updatedBy
              }
            });
          }
        }
      } else {
        // BACKWARD MOVEMENT: Delete all forward stage entries, reactivate target

        // 1. Get all stageIds with sequenceNumber > target
        const forwardStages = await tx.stage.findMany({
          where: {
            boardId: currentTicket.boardId,
            sequenceNumber: { gt: targetStage.sequenceNumber }
          },
          select: { id: true }
        });

        const forwardStageIds = forwardStages.map(s => s.id);

        // 2. Delete all entries for those forward stages
        if (forwardStageIds.length > 0) {
          await tx.ticketStageEta.deleteMany({
            where: {
              ticketId: ticketId,
              stageId: { in: forwardStageIds }
            }
          });

        }

        // 3. Reactivate target stage (set stageLeftAt to null)
        const targetEntry = await tx.ticketStageEta.findFirst({
          where: {
            ticketId: ticketId,
            stageId: targetStage.id
          }
        });

        if (targetEntry) {
          // Entry exists - reactivate it
          await tx.ticketStageEta.update({
            where: { id: targetEntry.id },
            data: {
              stageLeftAt: null,
              updatedAt: now,
              updatedBy: updatedBy
            }
          });
        } else {
          // Entry doesn't exist (edge case - create it)
          if (targetStage.eta !== null && targetStage.eta > 0) {
            const stageEtaDeadline = calculateETADeadline(now, targetStage.eta);
            await tx.ticketStageEta.create({
              data: {
                ticketId: ticketId,
                workspaceId: currentTicket.workspaceId,
                stageId: targetStage.id,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: stageEtaDeadline,
                updatedBy: updatedBy
              }
            });
          }
        }
      }

      // ETA domain-service evaluation: forecast (extend-only) + planning-risk state. Re-read
      // the active visit rather than trusting branch-local variables above, since a
      // reactivate-without-reset branch leaves the row's stageEta untouched - this is the one
      // authoritative source for "the actual deadline now in effect" regardless of which
      // branch fired above. This legacy path has no StageTransition concept (it never
      // consulted one for stageEta, unlike the non-linear service), so estimate resolution
      // here mirrors that: transition is always null, falling through to STAGE_DEFAULT.
      const activeVisitRow = await tx.ticketStageEta.findFirst({
        where: { ticketId, stageId: targetStage.id, stageLeftAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const deadlineTracked = activeVisitRow
        ? activeVisitRow.stageEta.getTime() !== activeVisitRow.stageEnteredAt.getTime()
        : false;
      const stepEstimate = resolveStepEstimate(
        { id: targetStage.id, eta: targetStage.eta },
        null,
        { requireExplicitTransition: false },
      );
      const boardEtaCtx = await loadBoardEtaContext(tx, currentTicket.boardId);
      const currentTicketEtaManagement = parseTicketEtaManagement(currentTicket.metadata);

      const etaResult = evaluateEta({
        ticketId,
        ticketStatus: newStatusV2,
        isTerminal: isTerminalStatus(newStatusV2),
        currentTicketEta: currentTicket.eta,
        currentTicketEtaManagement,
        boardType: boardEtaCtx.boardType,
        boardEtaManagement: boardEtaCtx.boardEtaManagement,
        currentStageId: targetStage.id,
        stages: boardEtaCtx.stages,
        transitions: boardEtaCtx.transitions,
        activeVisit: {
          stageVisitId: activeVisitRow?.id ?? null,
          transitionId: null,
          deadline: activeVisitRow?.stageEta ?? null,
          deadlineTracked,
          estimateSource: stepEstimate.source,
          estimateHours: stepEstimate.incomplete ? null : stepEstimate.hours,
        },
        trigger: 'STAGE_TRANSITION',
        now,
        globalKillSwitchEnabled: isEtaManagementKillSwitchActive(),
      });
      const mergedMetadata = mergeTicketEtaManagement(
        currentTicket.metadata,
        etaResult.ticketEtaManagementPatch,
      );

      // Update the ticket stage and status (synced with stage's default status), folding in
      // the ETA/metadata result from the same write when this path owns the ticket update.
      // When the optimistic-concurrency guard already updated stageName/statusV2 above (its
      // own committed write, needed so the guard can fail atomically before any stage-visit
      // work happens), eta/metadata still need a dedicated update here since that guarded
      // write never touched them.
      const updatedTicket = guardedUpdatedTicket
        ? await tx.ticket.update({
            where: { id: ticketId },
            data: {
              updatedBy: updatedBy,
              updatedAt: now,
              ...(etaResult.etaDecision.changed && etaResult.etaDecision.newEta
                ? { eta: etaResult.etaDecision.newEta }
                : {}),
              metadata: mergedMetadata as Prisma.InputJsonValue,
            },
          })
        : await tx.ticket.update({
            where: { id: ticketId },
            data: {
              stageName: newStageName,
              statusV2: newStatusV2,
              updatedBy: updatedBy,
              updatedAt: now,
              ...(etaResult.etaDecision.changed && etaResult.etaDecision.newEta
                ? { eta: etaResult.etaDecision.newEta }
                : {}),
              metadata: mergedMetadata as Prisma.InputJsonValue,
            },
          });

      // Create activity record for the stage change
      if (source === ActivitySource.WEBHOOK && prActivityData) {
        // For WEBHOOK source: Create PR activity with stage change info
        // Align stage change with base activity structure (field, oldValue, newValue)
        const activityValue: PRActivityValue = {
          action: this.getActionTextForPREvent(prActivityData.prEvent),
          prId: prActivityData.prId,
          prUrl: prActivityData.prUrl,
          repoName: prActivityData.repoName,
          sourceBranch: prActivityData.sourceBranchName,
          destinationBranch: prActivityData.destinationBranchName,
          ...(prActivityData.prAuthor ? { authorName: prActivityData.prAuthor } : {}),
          ...(stageChanged ? {
            // Stage change info - aligned with base activity structure
            field: 'stageName',
            oldValue: oldStageName ?? undefined,
            newValue: newStageName,
          } : {}),
          ...(prActivityData.remainingOpenPRs && prActivityData.remainingOpenPRs > 0 ? {
            remainingOpenPRs: prActivityData.remainingOpenPRs
          } : {})
        };

        await tx.ticketActivity.create({
          data: {
            ticketId: ticketId,
            workspaceId: currentTicket.workspaceId,
            updatedBy: updatedBy,
            activityType: ActivityType.PR,
            value: activityValue as Prisma.InputJsonValue,
            channelId: currentTicket.channelId
          }
        });

        logger.info('[TicketRepository] Created PR activity', {
          ticketId,
          prId: prActivityData.prId,
          action: prActivityData.prEvent,
          author: prActivityData.prAuthor || 'unknown',
        });
      } else if (source === ActivitySource.INTERNAL || source === ActivitySource.AUTOMATION) {
        // For INTERNAL / AUTOMATION source: Create STAGE_NAME activity
        await tx.ticketActivity.create({
          data: {
            ticketId: ticketId,
            workspaceId: currentTicket.workspaceId,
            updatedBy: updatedBy,
            activityType: ActivityType.STAGE_NAME,
            value: {
              field: 'stageName',
              oldValue: oldStageName,
              newValue: newStageName,
              source: source,
              ...(source === ActivitySource.AUTOMATION ? { isAutomation: true } : {}),
            } as Prisma.InputJsonValue,
            channelId: currentTicket.channelId
          }
        });

        logger.info('[TicketRepository] Created STAGE_NAME activity', {
          ticketId,
          oldStageName,
          newStageName,
        });
      }

      // Create STATUS activity if status changed (for both WEBHOOK and INTERNAL sources)
      if (statusChanged) {
        await recordTicketTimelineEvent(
          {
            activity: {
              ticketId: ticketId,
              workspaceId: currentTicket.workspaceId,
              updatedBy: updatedBy,
              activityType: ActivityType.STATUS,
              value: {
                field: 'statusV2',
                oldValue: oldStatusV2,
                newValue: newStatusV2,
                source: source,
                ...(source === ActivitySource.AUTOMATION ? { isAutomation: true } : {}),
              } as Prisma.InputJsonValue,
              channelId: currentTicket.channelId,
            },
          },
          tx,
        );

        logger.info('[TicketRepository] Created STATUS activity', {
          ticketId,
          oldStatusV2,
          newStatusV2,
        });
      }

      // Audit trail for the ETA evaluation (auto-recompute, risk detected/reopened/resolved) -
      // attributed to the system actor since these are computed by automatic recalculation,
      // not authored by the user who moved the stage.
      const activityIntents = buildEtaActivityIntents(etaResult, {
        currentStageId: targetStage.id,
        oldEta: currentTicket.eta ? currentTicket.eta.getTime() : null,
        boardConfigVersion: boardEtaCtx.boardEtaManagement.configVersion,
        trigger: 'STAGE_TRANSITION',
        systemReason: `Automatic recalculation after moving to stage "${newStageName}"`,
        previousRiskFingerprint: currentTicketEtaManagement.planningRisk.fingerprint,
      });
      await writeEtaActivitiesPrisma(tx, activityIntents, {
        ticketId,
        workspaceId: currentTicket.workspaceId,
        channelId: currentTicket.channelId,
        timestamp: now.getTime(),
        systemActorId,
      });

      return { updatedTicket, etaResult };
    });

    const updatedTicket = txResult.updatedTicket;

    // Post-commit notification dispatch - best-effort, must never affect the already-
    // committed response. suppressed while the ticket is paused.
    if (updatedTicket.statusV2 !== TicketStatusV2.PAUSED) {
      void dispatchEtaNotifications(etaSignalsFromResult(txResult.etaResult), {
        ticketId,
        createdBy: currentTicket.createdBy,
        assignedTo: currentTicket.assignedTo,
        ticketUserGroupId: currentTicket.userGroupId,
        boardId: currentTicket.boardId,
        actorId: updatedBy,
      }).catch(error => {
        logger.error('[TicketRepository] Failed to dispatch ETA notifications', { ticketId, error });
      });
    }

    await syncStageOverdueFlag(prisma, ticketId, now);

    if (statusChanged && options.cascadeFlow !== false) {
      await dispatchCommittedTicketStatusChange({
        ticketId,
        newStatus: newStatusV2,
        actorUserId: updatedBy,
      });
    }

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    if (
      newStatusV2 === TicketStatusV2.COMPLETED
      && oldStatusV2 !== TicketStatusV2.COMPLETED
      && isReleaseTicket(updatedTicket.ticketType as BaseTicketType | null)
    ) {
      // The ticket update above is already committed; deployed-version
      // bookkeeping must not fail the request or suppress the emits below.
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

    if (stageChanged || statusChanged) {
      const changes: TicketChanges = {};
      if (stageChanged) {
        changes.stageName = { previousValue: oldStageName ?? null, newValue: newStageName };
      }
      if (statusChanged && newStatusV2) {
        changes.statusV2 = { previousValue: oldStatusV2 ?? null, newValue: newStatusV2 };
      }
      void emitTicketUpdated({
        ticket: updatedTicket as TicketLike,
        changes,
        performedById: updatedBy,
      });
    }

    const updatedSnapshot = (await buildKanbanCountsSnapshot(updatedTicket.id)) ?? makeFallbackCountsSnapshot(updatedTicket as Parameters<typeof makeFallbackCountsSnapshot>[0]);
    websocketService.broadcastTicketCountsUpdate({
      operation: 'update',
      ticket: updatedSnapshot,
      previousTicket: {
        ...updatedSnapshot,
        stageName: oldStageName,
        statusV2: oldStatusV2,
        priority: currentTicket.priority,
        assignedTo: currentTicket.assignedTo,
      },
    });

    // Thread system message for the status change (activity rows for PR/STAGE_NAME/STATUS/ETA
    // were already written inside the transaction above). Messages are posted post-commit,
    // best-effort - a delivery failure here must not roll back the ticket transition.
    if (statusChanged) {
      // Create system message for status change
      if (currentTicket.conversationId) {
        // Get user name for the message
        const user = await prisma.user.findUnique({
          where: { id: updatedBy },
          select: { name: true }
        });

        const userName = user?.name || 'System';
        const actorLabel = `${userName}${source === ActivitySource.AUTOMATION ? ' (Automation)' : ''}`;
        const statusMessage = `${actorLabel} changed status from ${oldStatusV2} to ${newStatusV2}`;

        await recordTicketTimelineEvent({
          message: {
            conversationId: currentTicket.conversationId,
            senderId: updatedBy,
            content: statusMessage,
            activityType: ActivityType.STATUS,
            workspaceId: currentTicket.workspaceId,
            isAutomation: source === ActivitySource.AUTOMATION,
          },
        });

        logger.info(
          `[TicketRepository] Created status change message for ticket ${ticketId} in conversation ${currentTicket.conversationId}`
        );
      }
    }

    const flowSnapshot = (
      updatedTicket.metadata as {
        flow?: {
          nodeSnapshot?: {
            planNodeId?: string;
            title?: string;
            gate?: { type?: string; prompt?: string };
          };
        };
      } | null
    )?.flow?.nodeSnapshot;
    if (
      newStatusV2 === TicketStatusV2.COMPLETED &&
      oldStatusV2 !== TicketStatusV2.COMPLETED &&
      flowSnapshot?.gate?.type === 'confirmation'
    ) {
      await prisma.ticketActivity.create({
        data: {
          workspaceId: currentTicket.workspaceId,
          ticketId,
          updatedBy,
          activityType: ActivityType.METADATA,
          value: {
            field: 'flowConfirmation',
            planNodeId: flowSnapshot.planNodeId ?? null,
            prompt: flowSnapshot.gate.prompt?.trim() || null,
            confirmationText:
              flowSnapshot.gate.prompt?.trim() || flowSnapshot.title?.trim() || null,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return updatedTicket;
  }

  /**
   * Get ticket by ID with board information
   */
  async getTicketWithBoard(ticketId: string) {
    return await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        boardId: true,
        stageName: true,
        updatedBy: true,
        board: { select: { boardType: true } },
      }
    });
  }
  /**
   * Find ticket by conversation ID with minimal fields for meet callback
   */
  async findByConversationIdForMeet(conversationId: string) {
    return await prisma.ticket.findFirst({
      where: { conversationId },
      select: { xyneId: true, workspaceId: true, metadata: true },
    });
  }

  async findFirstByConversationId(conversationId: string) {
    return await prisma.ticket.findFirst({
      where: { conversationId },
      select: { id: true, workspaceId: true },
    });
  }

  /**
   * Find ticket by xyneId with minimal fields for meet callback
   */
  async findByXyneIdForMeet(xyneId: string, workspaceId: string) {
    return await prisma.ticket.findFirst({
      where: { xyneId, workspaceId },
      select: {
        id: true,
        conversationId: true,
        title: true,
        workspaceId: true,
      },
    });
  }

  /**
   * Get human-readable action text for PR event
   * @private
   */
  private getActionTextForPREvent(event: PRStatusEvent): string {
    const actionMap: Record<PRStatusEvent, string> = {
      [PRStatusEvent.CREATED]: 'raised',
      [PRStatusEvent.UPDATED]: 'updated',
      [PRStatusEvent.MERGED]: 'merged',
      [PRStatusEvent.DECLINED]: 'declined',
      [PRStatusEvent.DELETED]: 'deleted',
    };
    return actionMap[event] || 'updated';
  }

  /**
   * Get ticket by XYNE ID (e.g., "XYNE-123")
   */
  async getTicketByXyneId(xyneId: string, workspaceId: string) {
    return await prisma.ticket.findUnique({
      where: { workspaceId_xyneId: { workspaceId, xyneId } }
    });
  }

  /**
   * Get ticket by external xyneId or internal ticket id within a workspace.
   */
  async getTicketByXyneIdOrId(identifier: string, workspaceId: string) {
    return await prisma.ticket.findFirst({
      where: {
        workspaceId,
        OR: [{ xyneId: identifier }, { id: identifier }],
      },
    });
  }

  /**
   * Get ticket by ID with id and xyneId selection
   */
  async getTicketById(ticketId: string) {
    return await prisma.ticket.findUnique({
      where: { id: ticketId }
    });
  }

  async getTicketHistory(ticketId: string, limit = 100) {
    return await prisma.ticketActivity.findMany({
      where: { ticketId },
      select: {
        id: true,
        timestamp: true,
        activityType: true,
        value: true,
        updatedByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [
        { timestamp: 'desc' },
        { id: 'desc' },
      ],
      take: limit,
    });
  }


  /**
   * Get hotfix sub-tickets for a parent ticket
   */
  async getHotfixSubTickets(parentTicketId: string) {
    const mappings = await prisma.ticketSubTicketMapping.findMany({
      where: {
        ticketId: parentTicketId,
        subTicket: {
          mappedTicket: {
            ticketType: BaseTicketType.Hotfix
          }
        }
      },
      include: {
        subTicket: {
          include: {
            mappedTicket: true
          }
        }
      }
    });

    return mappings.map(m => m.subTicket);
  }

  async updateTicketAssignee(ticketId: string, newAssigneeId: string | null, updatedBy: string): Promise<void> {
    const previous = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { assignedTo: true },
    });
    const previousAssigneeId = previous?.assignedTo ?? null;

    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedTo: newAssigneeId,
        updatedBy: updatedBy,
        updatedAt: new Date(),
      }
    });

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    if (previousAssigneeId !== newAssigneeId) {
      void emitTicketUpdated({
        ticket: updatedTicket as TicketLike,
        changes: {
          assignedTo: { previousValue: previousAssigneeId, newValue: newAssigneeId },
        },
        performedById: updatedBy,
      });
    }

    const assigneeSnapshot = (await buildKanbanCountsSnapshot(updatedTicket.id)) ?? makeFallbackCountsSnapshot(updatedTicket as Parameters<typeof makeFallbackCountsSnapshot>[0]);
    websocketService.broadcastTicketCountsUpdate({
      operation: 'update',
      ticket: assigneeSnapshot,
      previousTicket: {
        ...assigneeSnapshot,
        assignedTo: previousAssigneeId,
      },
    });
  }

  async assignUserGroupToTicket(ticketId: string, groupId: string, updatedBy: string): Promise<void> {
    const previous = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { userGroupId: true },
    });
    const previousGroupId = previous?.userGroupId ?? null;

    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        userGroupId: groupId,
        updatedBy: updatedBy,
        updatedAt: new Date(),
      }
    });

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    if (previousGroupId !== groupId) {
      void emitTicketUpdated({
        ticket: updatedTicket as TicketLike,
        changes: {
          userGroupId: { previousValue: previousGroupId, newValue: groupId },
        },
        performedById: updatedBy,
      });
    }
  } 

  async updateTicketMetadata(ticketId: string, metadata: Record<string, any>): Promise<void> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { metadata: true }
    });

    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const existingMetadata = (ticket.metadata as Record<string, any>) || {};

    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        metadata: {
          ...existingMetadata,
          ...metadata
        }
      }
    });

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);
  }

  async updateTicketFields(
    ticketId: string,
    fields: {
      title?: string;
      description?: string;
      priority?: TicketPriority;
      statusV2?: TicketStatusV2;
      eta?: Date | null;
      ticketType?: string | null;
      isArchived?: boolean;
      closedAt?: Date | null;
      closedBy?: string | null;
      aiPriority?: string;
    },
    updatedBy: string,
    options: { cascadeFlow?: boolean } = {},
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedBy, updatedAt: new Date() };
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.priority !== undefined) data.priority = fields.priority;
    if (fields.statusV2 !== undefined) data.statusV2 = fields.statusV2;
    if (fields.eta !== undefined) data.eta = fields.eta;
    if (fields.ticketType !== undefined) data.ticketType = fields.ticketType;
    if (fields.isArchived !== undefined) data.isArchived = fields.isArchived;
    if (fields.closedAt !== undefined) data.closedAt = fields.closedAt;
    if (fields.closedBy !== undefined) data.closedBy = fields.closedBy;
    if (fields.aiPriority !== undefined) data.aiPriority = fields.aiPriority;

    if (Object.keys(data).length <= 2) {
      return;
    }

    const needsPrevRead =
      fields.statusV2 !== undefined ||
      fields.title !== undefined ||
      fields.description !== undefined ||
      fields.priority !== undefined ||
     fields.eta !== undefined ||
      fields.ticketType !== undefined ||
      fields.isArchived !== undefined;

    let prevSnapshot: {
      statusV2: TicketStatusV2 | null;
      title: string | null;
      description: string | null;
      priority: TicketPriority | null;
      eta: Date | null;
      ticketType?: string | null;
      isArchived?: boolean | null;
    } | null = null;
    if (needsPrevRead) {
      const prev = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          statusV2: true,
          title: true,
          description: true,
          priority: true,
          eta: true,
          ticketType: true,
          isArchived: true,
        },
      });
      prevSnapshot = prev
        ? {
            statusV2: prev.statusV2 as TicketStatusV2,
            title: prev.title,
            description: prev.description,
            priority: prev.priority as TicketPriority,
            eta: prev.eta,
            ticketType: prev.ticketType,
            isArchived: prev.isArchived,
          }
        : null;
    }
    const previousStatus: TicketStatusV2 | null = prevSnapshot?.statusV2 ?? null;

    const updatedTicket = await prisma.ticket.update({ where: { id: ticketId }, data });

    if (
      fields.statusV2 !== undefined
      && fields.statusV2 !== previousStatus
      && options.cascadeFlow !== false
    ) {
      await dispatchCommittedTicketStatusChange({
        ticketId,
        newStatus: fields.statusV2,
        actorUserId: updatedBy,
      });
    }

    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    if (
      fields.statusV2 === TicketStatusV2.COMPLETED
      && previousStatus !== TicketStatusV2.COMPLETED
      && isReleaseTicket(updatedTicket.ticketType as BaseTicketType | null)
    ) {
      // The ticket update above is already committed; deployed-version
      // bookkeeping must not fail the request or suppress the emits below.
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

    // Consolidate all field changes into a single TICKET_UPDATED emit.
    if (prevSnapshot) {
      const activities: Array<{ activityType: ActivityType; value: Prisma.InputJsonValue }> = [];
      const changes: TicketChanges = {};

      if (fields.statusV2 !== undefined && previousStatus !== fields.statusV2) {
        activities.push({
          activityType: ActivityType.STATUS,
          value: {
            field: 'statusV2',
            oldValue: previousStatus,
            newValue: fields.statusV2,
          },
        });
        changes.statusV2 = { previousValue: previousStatus, newValue: fields.statusV2 };
      }

      if (fields.title !== undefined && prevSnapshot.title !== fields.title) {
        activities.push({
          activityType: ActivityType.TITLE,
          value: { field: 'title', oldValue: prevSnapshot.title, newValue: fields.title },
        });
        changes.title = { previousValue: prevSnapshot.title, newValue: fields.title };
      }

      if (
        fields.description !== undefined &&
        prevSnapshot.description !== fields.description
      ) {
        activities.push({
          activityType: ActivityType.DESCRIPTION,
          value: {
            field: 'description',
            oldValue: prevSnapshot.description,
            newValue: fields.description,
          },
        });
        changes.description = {
          previousValue: prevSnapshot.description,
          newValue: fields.description,
        };
      }

      if (fields.priority !== undefined && prevSnapshot.priority !== fields.priority) {
        activities.push({
          activityType: ActivityType.PRIORITY,
          value: {
            field: 'priority',
            oldValue: prevSnapshot.priority,
            newValue: fields.priority,
          },
        });
        changes.priority = { previousValue: prevSnapshot.priority, newValue: fields.priority };
      }

      if (fields.eta !== undefined) {
        const prevEtaMs = prevSnapshot.eta ? prevSnapshot.eta.getTime() : null;
        const nextEtaMs = fields.eta ? fields.eta.getTime() : null;
        if (prevEtaMs !== nextEtaMs) {
          activities.push({
            activityType: ActivityType.ETA,
            value: {
              field: 'eta',
              oldValue: prevEtaMs,
              newValue: nextEtaMs,
            },
          });
          changes.eta = { previousValue: prevEtaMs, newValue: nextEtaMs };
        }
      }

      if (fields.ticketType !== undefined && prevSnapshot.ticketType !== fields.ticketType) {
        activities.push({
          activityType: ActivityType.TICKET_TYPE,
          value: {
            field: 'ticketType',
            oldValue: prevSnapshot.ticketType,
            newValue: fields.ticketType,
          },
        });
      }

      if (fields.isArchived === true && prevSnapshot.isArchived !== true) {
        activities.push({
          activityType: ActivityType.IS_ARCHIVED,
          value: {
            field: 'isArchived',
            oldValue: prevSnapshot.isArchived,
            newValue: true,
          },
        });
      }

      if (activities.length > 0) {
        await prisma.ticketActivity.createMany({
          data: activities.map(activity => ({
            ticketId,
            workspaceId: updatedTicket.workspaceId,
            updatedBy,
            activityType: activity.activityType,
            value: activity.value,
          })),
        });
      }

      if (Object.keys(changes).length > 0) {
        void emitTicketUpdated({
          ticket: updatedTicket as TicketLike,
          changes,
          performedById: updatedBy,
        });
      }
    }

    if (prevSnapshot) {
      const metadataSnapshot = (await buildKanbanCountsSnapshot(updatedTicket.id)) ?? makeFallbackCountsSnapshot(updatedTicket as Parameters<typeof makeFallbackCountsSnapshot>[0]);
      websocketService.broadcastTicketCountsUpdate({
        operation: 'update',
        ticket: metadataSnapshot,
        previousTicket: {
          ...metadataSnapshot,
          statusV2: previousStatus,
          priority: prevSnapshot.priority,
        },
      });
    }
  }

  async addTagsByName(
    ticketId: string,
    tags: string[],
  ): Promise<{ added: string[]; alreadyPresent: string[] }> {
    const requested = Array.from(new Set(tags.map(t => t.trim()).filter(t => t.length > 0)));
    if (requested.length === 0) return { added: [], alreadyPresent: [] };

    const existing = await prisma.ticketTag.findMany({
      where: { ticketId, name: { in: requested } },
      select: { name: true },
    });
    const alreadyPresent = existing.map(r => r.name);
    const toAdd = requested.filter(t => !alreadyPresent.includes(t));
    if (toAdd.length === 0) return { added: [], alreadyPresent };

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { workspaceId: true },
    });

    await prisma.ticketTag.createMany({
      data: toAdd.map(name => ({ ticketId, workspaceId: ticket.workspaceId, name })),
      skipDuplicates: true,
    });
    await dualWriteTicketTags(ticketId, toAdd, prisma);
    return { added: toAdd, alreadyPresent };
  }

  /**
   * List desk tickets raised by an external merchant (identified by email).
   * Matches ticket.metadata.reporterEmail and root inbound emails on the thread.
   */
  async findTicketsByMerchantSenderEmail(params: {
    channelIds: string[];
    senderEmail: string;
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }) {
    const normalizedSender =
      extractEmailAddress(params.senderEmail) ?? params.senderEmail.trim().toLowerCase();
    const channelIds = [...new Set(params.channelIds.map(id => id.trim()).filter(Boolean))];

    const matchingConversations = await prisma.email.findMany({
      where: {
        channelId: { in: channelIds },
        type: EmailType.DEFAULT,
        from: { contains: normalizedSender, mode: 'insensitive' },
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    const conversationIds = matchingConversations.map(row => row.conversationId);

    const reporterFilter: Prisma.TicketWhereInput[] = [
      { metadata: { path: ['reporterEmail'], equals: normalizedSender } },
    ];
    if (conversationIds.length > 0) {
      reporterFilter.push({ conversationId: { in: conversationIds } });
    }

    const where: Prisma.TicketWhereInput = {
      channelId: { in: channelIds },
      isArchived: false,
      OR: reporterFilter,
    };

    if (params.cursor) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: params.cursor.createdAt } },
            { createdAt: params.cursor.createdAt, id: { lt: params.cursor.id } },
          ],
        },
      ];
    }

    return prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      select: {
        id: true,
        xyneId: true,
        title: true,
        statusV2: true,
        stageName: true,
        priority: true,
        createdAt: true,
        lastEmailAt: true,
        conversationId: true,
        channelId: true,
        metadata: true,
      },
    });
  }
}
