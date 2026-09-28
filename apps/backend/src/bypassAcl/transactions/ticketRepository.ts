import { transaction } from '../base';
import { TicketRepository, prisma, type PrismaTransaction } from '@/database/repositories/ticketRepository';
import type { PrismaClient } from '@prisma/client';
import { evaluateEta, buildEtaActivityIntents, writeEtaActivitiesPrisma, resolveStepEstimate, isTerminalStatus } from '@/services/etaManagement';
import { loadBoardEtaContext } from '@/bypassAcl/transactions/prismaContext';
import { logger } from '@/utils/logger';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { ActivitySource, CreateTicketRequest } from '@/types/ticket';
import type { FormFieldChanges } from '@/automations/triggers/ticket-updated.trigger';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { TicketStatusV2, TicketPriority, PRStatusEvent, parseTicketEtaManagement, mergeTicketEtaManagement, parseBoardEtaManagement, PRActivityValue, ActivityType } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { lockTicketMetadataAndEta } from '@/bypassAcl/rowLockServices';
import { lockTicketStatusV2 } from '@/bypassAcl/rowLockServices';


/**
 * Ticket creation + initial stage visit + the ETA domain-service evaluation, run on whichever
 * client it is handed: the caller's own transaction when one was passed in, or the one
 * createTicketTx opens.
 */
export async function createTicketWithClient(client: PrismaTransaction | PrismaClient, data: CreateTicketRequest & { xyneId: string; createdBy: string; updatedBy: string; formFieldChanges?: FormFieldChanges }, selectedStage: any, stages: any[], kanbanPosition: string) {
  const board = await client.board.findUnique({ where: { id: data.boardId } });
  if (!board) {
    throw new Error(`Board ${data.boardId} not found`);
  }
  const transitions = await client.stageTransition.findMany({ where: { boardId: data.boardId } });
  const boardEtaManagement = parseBoardEtaManagement(board.metadata, board.boardType);

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
}

export function createTicketTx(data: CreateTicketRequest & { xyneId: string; createdBy: string; updatedBy: string; formFieldChanges?: FormFieldChanges }, selectedStage: any, stages: any[], kanbanPosition: string) {
  return transaction(['Board', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'createTicket: ticket creation with stage visit, ETA evaluation, and activity writes must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => createTicketWithClient(tx, data, selectedStage, stages, kanbanPosition));
}

export function updateTicketStageFlowGuardedTx(ticketId: string, oldStatusV2: TicketStatusV2, oldStageName: string, newStageName: string, newStatusV2: TicketStatusV2, updatedBy: string, requiredActiveFlowRootId: string) {
  return transaction(['Ticket'], 'updateTicketStage flow-guarded write: root-status lock plus ticket update must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    const root = await lockTicketStatusV2(tx, requiredActiveFlowRootId);
    const status = root?.statusV2 ?? null;
    if (status !== TicketStatusV2.STARTED) return null;
    return tx.ticket.update({
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
  });
}
export function updateTicketStageTx(isForwardMovement: boolean, currentStage: any, ticketId: string, now: Date, updatedBy: string, targetStage: any, currentTicket: any, newStatusV2: TicketStatusV2, guardedUpdatedTicket: any, newStageName: string, source: ActivitySource, prActivityData: { prEvent: PRStatusEvent; prId: number; prUrl: string; repoName: string; sourceBranchName: string; destinationBranchName: string; prAuthor?: string; remainingOpenPRs?: number; } | undefined, self: TicketRepository, stageChanged: boolean, oldStageName: any, statusChanged: boolean, oldStatusV2: TicketStatusV2, systemActorId: string) {
  return transaction(['Board', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'updateTicketStage: stage-visit rewrites with locked ETA evaluation plus ticket and activity writes must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
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

    // Re-read the visit instead of trusting the branch-local vars above: the
    // reactivate-without-reset branch leaves stageEta untouched, so only the row holds the
    // deadline actually in effect. No StageTransition on this legacy path -> STAGE_DEFAULT.
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
    // metadata AND eta were both read before this transaction opened, so a concurrent write
    // (e.g. acknowledgeEtaRisk, or a manual due-date edit) landing before ours would be lost.
    // FOR UPDATE locks the row so that can't happen. Both locked values feed evaluateEta:
    // eta is the extend-only baseline and a fingerprint input, so a stale one could decide
    // against - and then overwrite - a due date someone else just moved.
    const lockedTicket = await lockTicketMetadataAndEta(tx, ticketId);
    const lockedEta = lockedTicket?.eta ?? null;
    const boardEtaCtx = await loadBoardEtaContext(tx, currentTicket.boardId);
    const currentTicketEtaManagement = parseTicketEtaManagement(lockedTicket?.metadata);

    const etaResult = evaluateEta({
      ticketId,
      ticketStatus: newStatusV2,
      isTerminal: isTerminalStatus(newStatusV2),
      currentTicketEta: lockedEta,
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
    });
    const mergedMetadata = mergeTicketEtaManagement(
      lockedTicket?.metadata,
      etaResult.ticketEtaManagementPatch,
    );

    // The optimistic-concurrency guard above already committed stageName/statusV2 but never
    // eta/metadata, so those still need their own update on that branch.
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
        action: self.getActionTextForPREvent(prActivityData.prEvent),
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
      oldEta: lockedEta ? lockedEta.getTime() : null,
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
}
export function claimReleaseInsightsGenerationTx(ticketId: string, staleBefore: Date) {
  return transaction(['Ticket'], 'claimReleaseInsightsGeneration: release-insights generation claim flag must commit atomically; tx is not ACL-wrapped', prisma, 
    async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: { metadata: true },
      });
      if (!ticket) return false;
      const current = (ticket.metadata as Record<string, unknown> | null) ?? {};
      if (current.isGeneratingReleaseInsights === true) {
        const startedAt = current.insightsGenerationStartedAt;
        const started = typeof startedAt === 'string' ? Date.parse(startedAt) : NaN;
        if (Number.isFinite(started) && started >= staleBefore.getTime()) return false;
      }
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          metadata: {
            ...current,
            isGeneratingReleaseInsights: true,
            insightsGenerationStartedAt: new Date().toISOString(),
          } as Prisma.InputJsonObject,
        },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
