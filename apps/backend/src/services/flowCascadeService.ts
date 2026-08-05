import { Prisma } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';
import {
  BoardType,
  ChannelVisibility,
  FLOW_STAGE_NAMES,
  FlowPlanModel,
  MessageType,
  TicketPriority,
  TicketStatusV2,
  deserializeFlowPlan,
  flowDecisionOutcomeKey,
  flowGateOf,
  serializeFlowPlan,
  type FlowDecisionOutcome,
  type FlowReadinessOptions,
  type FlowPlanNode,
  type FlowRunNodeSnapshot,
} from '@xyne/shared';
import { db } from '@/database/client';
import { createFlowSubTicketMappings } from '@/services/subTicketService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { logger } from '@/utils/logger';
import { TicketIdService } from '@/services/ticketIdService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { messageMetadataService } from '@/services/messageMetadataService';
import { AppError } from '@/middleware/errorHandler';
import {
  ensureFlowStageTransition,
  findBackloggedCascadeTicketId,
} from '@/services/flowStageTransitionRecovery';

export interface FlowTicketMetadata {
  planNodeId?: string;
  rootTicketId: string;
  planSnapshot?: string;
  nodeSnapshot?: FlowRunNodeSnapshot;
  decisionOutcomes?: Record<string, FlowDecisionOutcome>;
}

const ticketRepository = new TicketRepository();
const FLOW_BACKLOGGABLE_STATUSES = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
] as const;

async function assertActiveFlowRun(rootTicketId: string): Promise<void> {
  const root = await db.ticket.findUnique({
    where: { id: rootTicketId },
    select: { statusV2: true },
  });
  if (root?.statusV2 === TicketStatusV2.PAUSED) {
    throw new AppError('Resume the Flow run before moving a group to backlog', 409);
  }
  if (root?.statusV2 !== TicketStatusV2.STARTED) {
    throw new AppError('Only an active Flow run can move a group to backlog', 409);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function freezeRunPlan(rootTicketId: string, model: FlowPlanModel): Promise<void> {
  const rootTicket = await db.ticket.findUnique({
    where: { id: rootTicketId },
    select: { metadata: true },
  });
  if (!rootTicket) return;

  const metadata = objectValue(rootTicket.metadata);
  const flow = objectValue(metadata.flow);
  if (typeof flow.planSnapshot === 'string') return;

  await db.ticket.update({
    where: { id: rootTicketId },
    data: {
      metadata: {
        ...metadata,
        flow: { ...flow, rootTicketId, planSnapshot: serializeFlowPlan(model.plan) },
      } as Prisma.InputJsonValue,
    },
  });
}

interface InstantiatedStep {
  ticketId: string;
  xyneId: string;
  statusV2: TicketStatusV2;
  stageName: string;
  nodeSnapshot?: FlowRunNodeSnapshot;
  decisionOutcomes?: Record<string, FlowDecisionOutcome>;
}

function stepSatisfied(step: InstantiatedStep | undefined): boolean {
  return (
    step?.statusV2 === TicketStatusV2.COMPLETED || step?.stageName === FLOW_STAGE_NAMES.BACKLOG
  );
}

function resolveFlowParentTicketIds(
  model: FlowPlanModel,
  instantiated: ReadonlyMap<string, InstantiatedStep>,
  parentId: string
): string[] {
  if (model.isDecision(parentId)) {
    const sourceId = model.getDecision(parentId)?.parentNodeId;
    const ticketId = sourceId ? instantiated.get(sourceId)?.ticketId : undefined;
    return ticketId ? [ticketId] : [];
  }
  if (model.isGroup(parentId)) {
    return model
      .terminalIdsOf(parentId)
      .map((terminalId) => instantiated.get(terminalId)?.ticketId)
      .filter((ticketId): ticketId is string => !!ticketId);
  }
  const ticketId = instantiated.get(parentId)?.ticketId;
  return ticketId ? [ticketId] : [];
}

export interface BacklogFlowGroupResult {
  createdCount: number;
  backloggedCount: number;
  unchangedCount: number;
}

function materializeRunModel(
  latest: FlowPlanModel,
  instantiated: Map<string, InstantiatedStep>
): FlowPlanModel {
  const snapshots = new Map(
    [...instantiated.entries()]
      .filter(
        (entry): entry is [string, InstantiatedStep & { nodeSnapshot: FlowRunNodeSnapshot }] =>
          !!entry[1].nodeSnapshot
      )
      .map(([id, step]) => [id, step.nodeSnapshot])
  );
  const nodes = latest.nodes.map((node) => {
    const snapshot = snapshots.get(node.id);
    return snapshot
      ? {
          id: snapshot.planNodeId,
          title: snapshot.title,
          order: snapshot.order,
          parentIds: snapshot.parentPlanNodeIds,
          gate: snapshot.gate,
          ...(snapshot.description !== undefined && { description: snapshot.description }),
          ...(snapshot.assignedTo !== undefined && { assignedTo: snapshot.assignedTo }),
          ...(snapshot.groupId && { groupId: snapshot.groupId }),
        }
      : node;
  });
  for (const [id, snapshot] of snapshots) {
    if (nodes.some((node) => node.id === id)) continue;
    nodes.push({
      id,
      title: snapshot.title,
      order: snapshot.order,
      parentIds: snapshot.parentPlanNodeIds,
      gate: snapshot.gate,
      ...(snapshot.description !== undefined && { description: snapshot.description }),
      ...(snapshot.assignedTo !== undefined && { assignedTo: snapshot.assignedTo }),
      ...(snapshot.groupId && { groupId: snapshot.groupId }),
    });
  }
  const groups = [...latest.groups];
  for (const snapshot of snapshots.values()) {
    if (!snapshot.groupId) continue;
    const latestGroup = latest.getGroup(snapshot.groupId);
    const frozenParentGroupId = latestGroup ? latestGroup.groupId : snapshot.groupParentGroupId;
    const frozen = {
      id: snapshot.groupId,
      name: snapshot.groupName ?? 'Group',
      parentIds: snapshot.groupParentPlanNodeIds ?? [],
      ...(latestGroup?.order !== undefined && { order: latestGroup.order }),
      ...(frozenParentGroupId && { groupId: frozenParentGroupId }),
    };
    const index = groups.findIndex((group) => group.id === snapshot.groupId);
    if (index >= 0) groups[index] = frozen;
    else groups.push(frozen);
    if (snapshot.groupParentGroupId && frozenParentGroupId === snapshot.groupParentGroupId) {
      const frozenParent = {
        id: snapshot.groupParentGroupId,
        name: snapshot.groupParentGroupName ?? 'Group',
        parentIds: snapshot.groupParentGroupParentPlanNodeIds ?? [],
      };
      const parentIndex = groups.findIndex((group) => group.id === snapshot.groupParentGroupId);
      if (parentIndex >= 0) groups[parentIndex] = frozenParent;
      else groups.push(frozenParent);
    }
  }
  return new FlowPlanModel({ ...latest.plan, nodes, groups });
}

/** Advances a FLOW run after a committed ticket status change. */
export async function onFlowTicketStatusChanged(params: {
  ticketId: string;
  newStatus: TicketStatusV2;
  actorUserId: string;
  evaluateSatisfiedStep?: boolean;
}): Promise<void> {
  try {
    const ticket = await db.ticket.findUnique({
      where: { id: params.ticketId },
      select: {
        id: true,
        boardId: true,
        projectId: true,
        channelId: true,
        metadata: true,
      },
    });
    if (!ticket) return;

    const board = await db.board.findUnique({
      where: { id: ticket.boardId },
      select: { id: true, boardType: true, flowPlan: true },
    });
    if (!board || board.boardType !== BoardType.FLOW) return;

    if (!board.flowPlan) return;

    const flowMeta = (ticket.metadata as { flow?: FlowTicketMetadata } | null)?.flow;
    const isRoot = !flowMeta?.planNodeId;
    const rootTicketId = isRoot ? ticket.id : flowMeta.rootTicketId;

    if (!rootTicketId) return;
    let model = new FlowPlanModel(deserializeFlowPlan(board.flowPlan));
    const instantiated = await getInstantiatedSteps(board.id, rootTicketId);
    model = materializeRunModel(model, instantiated);
    await pinLegacyDecisionDestinations(model, instantiated);

    const runParams = {
      boardId: board.id,
      rootTicketId,
      model,
      actorUserId: params.actorUserId,
    };

    const rootTicket = await db.ticket.findUnique({
      where: { id: rootTicketId },
      select: { workspaceId: true },
    });
    let automationUser = rootTicket
      ? await unifiedBotUserService.getBotByBotId('xyne-automatic', rootTicket.workspaceId)
      : null;
    if (rootTicket && !automationUser) {
      try {
        await unifiedBotUserService.syncAllBotUsers(rootTicket.workspaceId);
        automationUser = await unifiedBotUserService.getBotByBotId(
          'xyne-automatic',
          rootTicket.workspaceId
        );
      } catch (error) {
        logger.warn('[flowCascade] automatic bot unavailable; using triggering actor', { error });
      }
    }
    runParams.actorUserId = automationUser?.id ?? params.actorUserId;

    if (params.newStatus === TicketStatusV2.CANCELLED) {
      if (isRoot) await freezeRunPlan(rootTicketId, model);
      await cascadeCancel({
        cancelledPlanNodeId: isRoot ? null : flowMeta!.planNodeId!,
        isRoot,
        ...runParams,
      });
      // A cancelled branch can be the last open one — the run may be over now.
      await evaluateRunCompletion(runParams);
      return;
    }

    if (isRoot && params.newStatus === TicketStatusV2.COMPLETED) {
      await freezeRunPlan(rootTicketId, model);
      return;
    }

    const shouldEvaluate =
      params.newStatus === TicketStatusV2.COMPLETED ||
      (isRoot && params.newStatus === TicketStatusV2.STARTED) ||
      params.evaluateSatisfiedStep === true;
    if (!shouldEvaluate) return;

    await instantiateReadySteps(runParams);
    await evaluateRunCompletion(runParams);
  } catch (error) {
    logger.error('[flowCascade] failed to process status change', {
      ticketId: params.ticketId,
      newStatus: params.newStatus,
      error,
    });
  }
}

export async function onFlowStepBacklogged(params: {
  ticketId: string;
  actorUserId: string;
}): Promise<void> {
  await onFlowTicketStatusChanged({
    ...params,
    newStatus: TicketStatusV2.PAUSED,
    evaluateSatisfiedStep: true,
  });
}

/**
 * Materialize and backlog every live descendant of a run group.
 *
 * The command is intentionally idempotent: flow ticket/mapping ids are
 * deterministic, and terminal/backlogged steps are left unchanged. Conditions
 * are validated before any write because an unresolved route cannot tell us
 * which descendants belong to the live path.
 */
export async function backlogFlowGroup(params: {
  rootTicketId: string;
  groupId: string;
  actorUserId: string;
  workspaceId: string;
}): Promise<BacklogFlowGroupResult> {
  const rootTicket = await db.ticket.findUnique({
    where: { id: params.rootTicketId },
    select: {
      id: true,
      rootId: true,
      boardId: true,
      projectId: true,
      channelId: true,
      workspaceId: true,
      statusV2: true,
      metadata: true,
      board: { select: { boardType: true, flowPlan: true } },
      channel: {
        select: {
          visibility: true,
          participants: {
            where: { userId: params.actorUserId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!rootTicket || rootTicket.rootId !== null) {
    throw new AppError('Flow run not found', 404);
  }
  if (rootTicket.workspaceId !== params.workspaceId) {
    throw new AppError('You do not have access to this Flow run', 403);
  }
  if (
    rootTicket.channel.visibility === ChannelVisibility.PRIVATE &&
    rootTicket.channel.participants.length === 0
  ) {
    throw new AppError('You must be a member of this private channel', 403);
  }
  if (rootTicket.board.boardType !== BoardType.FLOW || !rootTicket.board.flowPlan) {
    throw new AppError('Ticket is not a Flow run', 400);
  }
  if (rootTicket.statusV2 === TicketStatusV2.PAUSED) {
    throw new AppError('Resume the Flow run before moving a group to backlog', 409);
  }
  if (rootTicket.statusV2 !== TicketStatusV2.STARTED) {
    throw new AppError('Only an active Flow run can move a group to backlog', 409);
  }

  const instantiated = await getInstantiatedSteps(rootTicket.boardId, rootTicket.id);
  const rootFlow = (rootTicket.metadata as { flow?: FlowTicketMetadata } | null)?.flow;
  let model = new FlowPlanModel(
    deserializeFlowPlan(rootFlow?.planSnapshot ?? rootTicket.board.flowPlan)
  );
  model = materializeRunModel(model, instantiated);
  await pinLegacyDecisionDestinations(model, instantiated);

  const group = model.getGroup(params.groupId);
  if (!group || !model.isActiveGroup(group.id)) {
    throw new AppError('Flow group not found in this run', 404);
  }

  const decisionOutcomes = new Map<string, FlowDecisionOutcome>();
  for (const decision of model.decisions) {
    const outcome = instantiated.get(decision.parentNodeId)?.decisionOutcomes?.[decision.id];
    if (outcome) decisionOutcomes.set(decision.id, outcome);
  }
  model = model.withResolvedDecisionTargets(decisionOutcomes);

  const statusByNodeId = new Map(
    [...instantiated].map(([nodeId, step]) => [
      nodeId,
      step.stageName === FLOW_STAGE_NAMES.BACKLOG ? FLOW_STAGE_NAMES.BACKLOG : step.statusV2,
    ])
  );
  const skipped = model.skippedPlanNodeIds(statusByNodeId, false, decisionOutcomes);
  const members = model.descendantMembersOf(group.id);
  const memberIds = new Set(members.map((member) => member.id));
  const childGroupIds = new Set(model.childGroupsOf(group.id).map((child) => child.id));
  const targetEntityIds = new Set([
    ...model.groupAndAncestorIds(group.id),
    ...childGroupIds,
    ...memberIds,
  ]);

  const unresolvedDecision = model.decisions.find((decision) => {
    if (decisionOutcomes.has(decision.id) || skipped.has(decision.parentNodeId)) return false;
    return (
      memberIds.has(decision.parentNodeId) ||
      decision.routes.some((route) => targetEntityIds.has(route.targetId))
    );
  });
  if (unresolvedDecision) {
    const stepName = model.getNode(unresolvedDecision.parentNodeId)?.title ?? 'conditional step';
    throw new AppError(
      `Resolve conditional step "${stepName}" before moving this group to backlog.`,
      409
    );
  }

  const liveMembers = members.filter((member) => !skipped.has(member.id));
  if (liveMembers.length === 0) {
    throw new AppError('This group has no live steps to move to backlog', 409);
  }

  const existingBefore = new Set(instantiated.keys());
  for (const node of liveMembers) {
    if (instantiated.has(node.id)) continue;
    await createFlowStepTicket({
      node,
      model,
      rootTicket,
      rootTicketId: rootTicket.id,
      actorUserId: params.actorUserId,
      requireActiveRoot: true,
    });
  }

  // Existing members do not pass through createFlowStepTicket's locked root
  // check, so revalidate before adding mappings or changing their stages.
  await assertActiveFlowRun(rootTicket.id);

  const refreshed = await getInstantiatedSteps(rootTicket.boardId, rootTicket.id);
  for (const node of liveMembers) {
    const step = refreshed.get(node.id);
    if (!step) {
      throw new Error(`Flow step "${node.title}" could not be materialized`);
    }
    const parentTicketIds = [
      ...new Set(
        model
          .effectiveParentIds(node)
          .flatMap((parentId) => resolveFlowParentTicketIds(model, refreshed, parentId))
      ),
    ];
    await createFlowSubTicketMappings({
      parentTicketIds: parentTicketIds.length > 0 ? parentTicketIds : [rootTicket.id],
      title: node.title,
      description: node.description ?? null,
      createdBy: params.actorUserId,
      assignedTo: node.assignedTo ?? null,
      mappedTicketId: step.ticketId,
      subTicketXyneId: step.xyneId,
      rootTicketId: rootTicket.id,
    });
  }

  let backloggedCount = 0;
  let unchangedCount = 0;
  let lastBackloggedTicketId = findBackloggedCascadeTicketId(
    liveMembers
      .map((member) => refreshed.get(member.id))
      .filter((step): step is InstantiatedStep => step !== undefined),
    FLOW_STAGE_NAMES.BACKLOG
  );
  const readStageName = async (ticketId: string): Promise<string | null> =>
    (
      await db.ticket.findUnique({
        where: { id: ticketId },
        select: { stageName: true },
      })
    )?.stageName ?? null;
  for (const node of liveMembers) {
    const step = refreshed.get(node.id);
    if (!step) {
      throw new Error(`Flow step "${node.title}" could not be materialized`);
    }
    if (
      step.stageName === FLOW_STAGE_NAMES.BACKLOG ||
      step.statusV2 === TicketStatusV2.COMPLETED ||
      step.statusV2 === TicketStatusV2.CANCELLED
    ) {
      if (step.stageName === FLOW_STAGE_NAMES.BACKLOG) {
        lastBackloggedTicketId = step.ticketId;
      }
      unchangedCount += 1;
      continue;
    }
    if (step.stageName === FLOW_STAGE_NAMES.TODO) {
      const started = await ensureFlowStageTransition({
        targetStageName: FLOW_STAGE_NAMES.STARTED,
        transition: () =>
          ticketRepository.updateTicketStage(
            step.ticketId,
            FLOW_STAGE_NAMES.STARTED,
            params.actorUserId,
            undefined,
            undefined,
            {
              cascadeFlow: false,
              allowedCurrentStatuses: FLOW_BACKLOGGABLE_STATUSES,
              requiredActiveFlowRootId: rootTicket.id,
            }
          ),
        readStageName: () => readStageName(step.ticketId),
      });
      if (!started) {
        await assertActiveFlowRun(rootTicket.id);
        unchangedCount += 1;
        continue;
      }
    }
    const backlogged = await ensureFlowStageTransition({
      targetStageName: FLOW_STAGE_NAMES.BACKLOG,
      transition: () =>
        ticketRepository.updateTicketStage(
          step.ticketId,
          FLOW_STAGE_NAMES.BACKLOG,
          params.actorUserId,
          undefined,
          undefined,
          {
            cascadeFlow: false,
            allowedCurrentStatuses: FLOW_BACKLOGGABLE_STATUSES,
            requiredActiveFlowRootId: rootTicket.id,
          }
        ),
      readStageName: () => readStageName(step.ticketId),
    });
    if (!backlogged) {
      await assertActiveFlowRun(rootTicket.id);
      unchangedCount += 1;
      continue;
    }
    backloggedCount += 1;
    lastBackloggedTicketId = step.ticketId;
  }

  if (lastBackloggedTicketId) {
    await onFlowStepBacklogged({
      ticketId: lastBackloggedTicketId,
      actorUserId: params.actorUserId,
    });
  }

  return {
    createdCount: liveMembers.filter((member) => !existingBefore.has(member.id)).length,
    backloggedCount,
    unchangedCount,
  };
}

export async function onFlowPlanUpdated(params: {
  boardId: string;
  actorUserId: string;
}): Promise<void> {
  const activeRuns = await db.ticket.findMany({
    where: {
      boardId: params.boardId,
      rootId: null,
      statusV2: TicketStatusV2.STARTED,
    },
    select: { id: true },
  });

  for (const run of activeRuns) {
    await onFlowTicketStatusChanged({
      ticketId: run.id,
      newStatus: TicketStatusV2.STARTED,
      actorUserId: params.actorUserId,
    });
  }
}

async function getInstantiatedSteps(
  boardId: string,
  rootTicketId: string
): Promise<Map<string, InstantiatedStep>> {
  const tickets = await db.ticket.findMany({
    where: {
      boardId,
      rootId: rootTicketId,
    },
    select: { id: true, xyneId: true, statusV2: true, stageName: true, metadata: true },
  });
  const byPlanNodeId = new Map<string, InstantiatedStep>();
  for (const ticket of tickets) {
    const flow = (ticket.metadata as { flow?: FlowTicketMetadata } | null)?.flow;
    if (flow?.planNodeId) {
      byPlanNodeId.set(flow.planNodeId, {
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        statusV2: ticket.statusV2 as TicketStatusV2,
        stageName: ticket.stageName,
        ...(flow.nodeSnapshot && { nodeSnapshot: flow.nodeSnapshot }),
        ...(flow.decisionOutcomes && { decisionOutcomes: flow.decisionOutcomes }),
      });
    }
  }
  return byPlanNodeId;
}

function historicalDecisionTargetIds(
  decisionId: string,
  instantiated: ReadonlyMap<string, InstantiatedStep>
): Set<string> {
  const targets = new Set<string>();
  for (const [planNodeId, step] of instantiated) {
    const snapshot = step.nodeSnapshot;
    if (!snapshot) continue;
    if (snapshot.parentPlanNodeIds.includes(decisionId)) targets.add(planNodeId);
    if (snapshot.groupId && snapshot.groupParentPlanNodeIds?.includes(decisionId)) {
      targets.add(snapshot.groupId);
    }
    if (
      snapshot.groupParentGroupId &&
      snapshot.groupParentGroupParentPlanNodeIds?.includes(decisionId)
    ) {
      targets.add(snapshot.groupParentGroupId);
    }
  }
  return targets;
}

/** Backfill the immutable destination for outcomes written before target pinning. */
async function pinLegacyDecisionDestinations(
  model: FlowPlanModel,
  instantiated: Map<string, InstantiatedStep>
): Promise<void> {
  for (const decision of model.decisions) {
    const source = instantiated.get(decision.parentNodeId);
    const outcome = source?.decisionOutcomes?.[decision.id];
    if (!source || !outcome || outcome.targetId !== undefined) continue;

    const historicalTargets = historicalDecisionTargetIds(decision.id, instantiated);
    const configuredTarget = model.routeForOutcome(decision.id, outcome.outcomeKey)?.targetId;
    const targetId =
      historicalTargets.size === 1
        ? [...historicalTargets][0]
        : historicalTargets.size === 0
          ? (configuredTarget ?? null)
          : null;
    if (historicalTargets.size > 1) {
      logger.error('[flowCascade] decision has conflicting historical destinations', {
        decisionId: decision.id,
        sourceTicketId: source.ticketId,
        targetIds: [...historicalTargets],
      });
    }

    const pinned: FlowDecisionOutcome = { ...outcome, targetId };
    const ticket = await db.ticket.findUnique({
      where: { id: source.ticketId },
      select: { metadata: true },
    });
    if (!ticket) continue;
    const metadata = objectValue(ticket.metadata);
    const flow = objectValue(metadata.flow);
    const currentOutcomes = objectValue(flow.decisionOutcomes) as Record<
      string,
      FlowDecisionOutcome
    >;
    await db.ticket.update({
      where: { id: source.ticketId },
      data: {
        metadata: {
          ...metadata,
          flow: {
            ...flow,
            decisionOutcomes: { ...currentOutcomes, [decision.id]: pinned },
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    source.decisionOutcomes = { ...source.decisionOutcomes, [decision.id]: pinned };
  }
}

async function evaluateReadyDecisions(
  model: FlowPlanModel,
  instantiated: Map<string, InstantiatedStep>
): Promise<void> {
  for (const decision of model.decisions) {
    const source = instantiated.get(decision.parentNodeId);
    if (!source || !stepSatisfied(source) || source.decisionOutcomes?.[decision.id]) continue;
    const sourceNode = model.getNode(decision.parentNodeId);
    const sourceFormId = sourceNode?.gate?.type === 'form' ? sourceNode.gate.formId : null;
    if (!sourceFormId) continue;
    const fieldMembership = await db.formFields.findUnique({
      where: { id: decision.fieldId },
      select: { globalFieldId: true },
    });
    const storedFieldIds = [decision.fieldId, fieldMembership?.globalFieldId].filter(
      (fieldId): fieldId is string => !!fieldId
    );
    const formValue = await db.formEntityValues.findFirst({
      where: {
        entityId: source.ticketId,
        formId: sourceFormId,
        contextId: decision.parentNodeId,
        fieldId: { in: storedFieldIds },
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
      select: { actualFieldValue: true, fieldValue: true },
    });
    const rawValue = formValue?.actualFieldValue ?? formValue?.fieldValue;
    const outcomeKey = flowDecisionOutcomeKey(decision, rawValue);
    const selectedRoute = outcomeKey ? model.routeForOutcome(decision.id, outcomeKey) : undefined;
    if (!outcomeKey || !selectedRoute) {
      logger.error('[flowCascade] decision could not evaluate', {
        decisionId: decision.id,
        sourceTicketId: source.ticketId,
      });
      continue;
    }
    const ticket = await db.ticket.findUnique({
      where: { id: source.ticketId },
      select: { metadata: true },
    });
    if (!ticket) continue;
    const metadata = objectValue(ticket.metadata);
    const flow = objectValue(metadata.flow);
    const currentOutcomes = objectValue(flow.decisionOutcomes) as Record<
      string,
      FlowDecisionOutcome
    >;
    const result: FlowDecisionOutcome = {
      outcomeKey,
      targetId: selectedRoute.targetId,
      evaluatedAt: Date.now(),
    };
    await db.ticket.update({
      where: { id: source.ticketId },
      data: {
        metadata: {
          ...metadata,
          flow: {
            ...flow,
            decisionOutcomes: { ...currentOutcomes, [decision.id]: result },
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    source.decisionOutcomes = { ...source.decisionOutcomes, [decision.id]: result };
    logger.info('[flowCascade] evaluated decision', {
      decisionId: decision.id,
      outcomeKey,
      sourceTicketId: source.ticketId,
    });
  }
}

function evaluateFlowReadiness(
  model: FlowPlanModel,
  instantiated: Map<string, InstantiatedStep>,
  options: FlowReadinessOptions = {}
) {
  const statusByNodeId = new Map(
    [...instantiated.entries()].map(([nodeId, step]) => [
      nodeId,
      step.stageName === FLOW_STAGE_NAMES.BACKLOG ? FLOW_STAGE_NAMES.BACKLOG : step.statusV2,
    ])
  );
  const decisionOutcomeById = new Map(
    model.decisions.flatMap((decision) => {
      const outcome = instantiated.get(decision.parentNodeId)?.decisionOutcomes?.[decision.id];
      return outcome ? ([[decision.id, outcome]] as const) : [];
    })
  );
  return model.evaluateReadiness(statusByNodeId, decisionOutcomeById, options);
}

/** Instantiates each uncreated step whose effective parents are complete. */
async function instantiateReadySteps(params: {
  boardId: string;
  rootTicketId: string;
  model: FlowPlanModel;
  actorUserId: string;
}): Promise<void> {
  const rootTicket = await db.ticket.findUnique({
    where: { id: params.rootTicketId },
    select: {
      id: true,
      boardId: true,
      projectId: true,
      channelId: true,
      workspaceId: true,
      statusV2: true,
    },
  });
  if (!rootTicket) return;

  const rootActive =
    rootTicket.statusV2 === TicketStatusV2.STARTED ||
    rootTicket.statusV2 === TicketStatusV2.COMPLETED;

  const instantiated = await getInstantiatedSteps(params.boardId, params.rootTicketId);
  const model = params.model;
  await evaluateReadyDecisions(model, instantiated);
  const readiness = evaluateFlowReadiness(model, instantiated, { rootActive });
  const readySteps = model.nodes
    .filter((node) => readiness.readyNodeIds.has(node.id))
    .sort((a, b) => model.compareTraversalOrder(a.id, b.id));

  for (const node of readySteps) {
    try {
      const created = await createFlowStepTicket({
        node,
        model,
        rootTicket,
        rootTicketId: params.rootTicketId,
        actorUserId: params.actorUserId,
      });
      const parentTicketIds = [
        ...new Set(
          model
            .effectiveParentIds(node)
            .flatMap((parentId) => resolveFlowParentTicketIds(model, instantiated, parentId))
        ),
      ];
      await createFlowSubTicketMappings({
        parentTicketIds: parentTicketIds.length > 0 ? parentTicketIds : [params.rootTicketId],
        title: node.title,
        description: node.description ?? null,
        createdBy: params.actorUserId,
        assignedTo: node.assignedTo ?? null,
        mappedTicketId: created.id,
        subTicketXyneId: created.xyneId,
        rootTicketId: params.rootTicketId,
      });
      await ticketRepository.updateTicketStage(
        created.id,
        FLOW_STAGE_NAMES.STARTED,
        params.actorUserId,
        undefined,
        undefined,
        { cascadeFlow: false }
      );
      await ticketRepository.updateTicketStage(
        created.id,
        FLOW_STAGE_NAMES.PAUSED,
        params.actorUserId,
        undefined,
        undefined,
        { cascadeFlow: false }
      );
      logger.info(
        `[flowCascade] instantiated step ticket=${created.id} planNode=${node.id} run=${params.rootTicketId}`
      );
    } catch (error) {
      logger.error('[flowCascade] failed to instantiate step', {
        planNodeId: node.id,
        rootTicketId: params.rootTicketId,
        error,
      });
    }
  }
}

async function createFlowStepTicket(params: {
  node: FlowPlanNode;
  model: FlowPlanModel;
  rootTicket: { boardId: string; projectId: string; channelId: string; workspaceId: string };
  rootTicketId: string;
  actorUserId: string;
  requireActiveRoot?: boolean;
}): Promise<{ id: string; xyneId: string }> {
  const { node, model, rootTicket, rootTicketId, actorUserId, requireActiveRoot } = params;
  const deterministicTicketId = uuidv5(
    `flow-ticket:${rootTicketId}:${node.id}`,
    '98175b0b-310d-50de-852f-0f6df9be4c30'
  );
  const group = node.groupId ? model.getGroup(node.groupId) : undefined;
  const parentGroup = group?.groupId ? model.getGroup(group.groupId) : undefined;
  const nodeSnapshot: FlowRunNodeSnapshot = {
    planNodeId: node.id,
    title: node.title,
    ...(node.description !== undefined && { description: node.description }),
    ...(node.assignedTo !== undefined && { assignedTo: node.assignedTo }),
    gate: flowGateOf(node),
    ...(node.groupId && { groupId: node.groupId, groupName: group?.name ?? null }),
    ...(parentGroup && {
      groupParentGroupId: parentGroup.id,
      groupParentGroupName: parentGroup.name,
      groupParentGroupParentPlanNodeIds: parentGroup.parentIds,
    }),
    parentPlanNodeIds: node.parentIds,
    order: node.order,
    ...(group && { groupParentPlanNodeIds: group.parentIds }),
  };

  try {
    const ticket = await db.$transaction(async (tx) => {
      if (requireActiveRoot) {
        const [lockedRoot] = await tx.$queryRaw<{ statusV2: TicketStatusV2 }[]>`
          SELECT "statusV2"
          FROM "tickets"
          WHERE "id" = ${rootTicketId}
          FOR UPDATE
        `;
        if (lockedRoot?.statusV2 !== TicketStatusV2.STARTED) {
          throw new AppError('Only an active Flow run can move a group to backlog', 409);
        }
      }
      const conversationId = uuidv5(
        `flow-conversation:${rootTicketId}:${node.id}`,
        '98175b0b-310d-50de-852f-0f6df9be4c30'
      );
      const initialMessageId = uuidv5(
        `flow-message:${rootTicketId}:${node.id}`,
        '98175b0b-310d-50de-852f-0f6df9be4c30'
      );
      await tx.conversation.create({
        data: {
          conversationId,
          channelId: rootTicket.channelId,
          createdBy: actorUserId,
          initialMessageId,
          pinned: false,
          doNotPostToChannel: false,
        },
      });
      const xyneId = await TicketIdService.generateTicketId(tx, rootTicket.projectId);
      const created = await ticketRepository.createTicket(
        {
          id: deterministicTicketId,
          title: node.title,
          description: node.description || node.title,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          conversationId,
          channelId: rootTicket.channelId,
          projectId: rootTicket.projectId,
          workspaceId: rootTicket.workspaceId,
          boardId: rootTicket.boardId,
          statusV2: TicketStatusV2.TODO,
          stageName: FLOW_STAGE_NAMES.TODO,
          priority: TicketPriority.LOW,
          xyneId,
          ...(node.assignedTo && { assignedTo: node.assignedTo }),
          rootId: rootTicketId,
          metadata: { flow: { planNodeId: node.id, rootTicketId, nodeSnapshot } },
        },
        tx
      );
      await tx.message.create({
        data: {
          messageId: initialMessageId,
          conversationId,
          workspaceId: rootTicket.workspaceId,
          senderId: actorUserId,
          content: `Flow step created: ${node.title}`,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: true,
          showInChannel: true,
          createdAt: new Date(),
          metadata: { ticketId: created.id },
        },
      });
      await tx.conversation.update({
        where: { conversationId },
        data: { ticketId: created.id },
      });
      await tx.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId: actorUserId } },
        create: {
          id: uuidv5(
            `flow-participant:${conversationId}:${actorUserId}`,
            '98175b0b-310d-50de-852f-0f6df9be4c30'
          ),
          conversationId,
          userId: actorUserId,
          participationType: 'MENTIONED',
          isSubscribed: true,
          joinedAt: new Date(),
          channelId: rootTicket.channelId,
        },
        update: { participationType: 'MENTIONED', isSubscribed: true },
      });
      return created;
    });
    await messageMetadataService.syncInitialMessageMd(ticket.conversationId);
    await syncConversationTicketMdFromPrismaTicket(db, ticket);
    return { id: ticket.id, xyneId: ticket.xyneId };
  } catch (error) {
    const existing = await db.ticket.findUnique({
      where: { id: deterministicTicketId },
      select: { id: true, xyneId: true },
    });
    if (existing) return existing;
    throw error;
  }
}

/** Finds steps that can never instantiate because a dependency is blocked. */
function computeDeadPlanNodeIds(
  model: FlowPlanModel,
  instantiated: Map<string, InstantiatedStep>
): Set<string> {
  return evaluateFlowReadiness(model, instantiated).deadNodeIds;
}

/** Completes the root when every step is terminal or permanently blocked. */
async function evaluateRunCompletion(params: {
  boardId: string;
  rootTicketId: string;
  model: FlowPlanModel;
  actorUserId: string;
}): Promise<void> {
  const rootTicket = await db.ticket.findUnique({
    where: { id: params.rootTicketId },
    select: { id: true, statusV2: true },
  });
  if (
    !rootTicket ||
    rootTicket.statusV2 === TicketStatusV2.COMPLETED ||
    rootTicket.statusV2 === TicketStatusV2.CANCELLED
  ) {
    return;
  }
  if (params.model.isEmpty) return;

  const instantiated = await getInstantiatedSteps(params.boardId, params.rootTicketId);
  const dead = computeDeadPlanNodeIds(params.model, instantiated);

  for (const node of params.model.nodes) {
    const step = instantiated.get(node.id);
    if (step) {
      if (!stepSatisfied(step) && step.statusV2 !== TicketStatusV2.CANCELLED) {
        return; // a step is still running
      }
    } else if (!dead.has(node.id)) {
      return; // a step can still instantiate later
    }
  }

  if ([...instantiated.values()].some((step) => step.stageName === FLOW_STAGE_NAMES.BACKLOG)) {
    return;
  }

  await freezeRunPlan(rootTicket.id, params.model);
  await ticketRepository.updateTicketStage(
    rootTicket.id,
    FLOW_STAGE_NAMES.COMPLETED,
    params.actorUserId,
    undefined,
    undefined,
    { cascadeFlow: false }
  );
  logger.info(
    `[flowCascade] run completed — auto-completed main ticket=${rootTicket.id} run=${params.rootTicketId}`
  );
}

async function cascadeCancel(params: {
  cancelledPlanNodeId: string | null;
  isRoot: boolean;
  boardId: string;
  rootTicketId: string;
  model: FlowPlanModel;
  actorUserId: string;
}): Promise<void> {
  // Cancelling a group member also reaches its internal and outer descendants.
  const model = params.model;

  const entityChildren = new Map<string, string[]>();
  const addChild = (parentId: string, childId: string): void => {
    const list = entityChildren.get(parentId) ?? [];
    list.push(childId);
    entityChildren.set(parentId, list);
  };
  for (const node of model.nodes) {
    if (model.isMember(node)) continue;
    for (const parentId of node.parentIds) addChild(parentId, node.id);
  }
  for (const group of model.groups) {
    for (const parentId of group.parentIds) addChild(parentId, group.id);
  }
  for (const decision of model.decisions) {
    for (const targetId of model.targetIdsOfDecision(decision.id)) {
      addChild(decision.parentNodeId, targetId);
    }
  }
  const internalChildren = new Map<string, string[]>();
  const addInternalChild = (parentId: string, childId: string): void => {
    const list = internalChildren.get(parentId) ?? [];
    list.push(childId);
    internalChildren.set(parentId, list);
  };
  for (const node of model.nodes) {
    if (!model.isMember(node)) continue;
    for (const parentId of node.parentIds) {
      addInternalChild(parentId, node.id);
    }
  }
  for (const group of model.groups) {
    if (!group.groupId) continue;
    for (const parentId of group.parentIds) addInternalChild(parentId, group.id);
  }

  const descendantPlanNodeIds = new Set<string>();
  const collectFromEntities = (startIds: string[]): void => {
    const queue = [...startIds];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      if (model.isGroup(id)) {
        for (const member of model.descendantMembersOf(id)) {
          descendantPlanNodeIds.add(member.id);
        }
      } else {
        descendantPlanNodeIds.add(id);
      }
      queue.push(...(entityChildren.get(id) ?? []));
    }
  };

  if (params.isRoot) {
    for (const node of model.nodes) descendantPlanNodeIds.add(node.id);
  } else {
    const cancelledNode = model.nodes.find((node) => node.id === params.cancelledPlanNodeId);
    if (!cancelledNode) return;
    if (model.isMember(cancelledNode)) {
      const queue = [...(internalChildren.get(cancelledNode.id) ?? [])];
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) continue;
        if (model.isGroup(id)) {
          for (const member of model.descendantMembersOf(id)) {
            if (!descendantPlanNodeIds.has(member.id)) descendantPlanNodeIds.add(member.id);
          }
        } else if (!descendantPlanNodeIds.has(id)) {
          descendantPlanNodeIds.add(id);
        }
        queue.push(...(internalChildren.get(id) ?? []));
      }
      const directGroup = model.getGroup(cancelledNode.groupId ?? '');
      const outerGroupId = directGroup?.groupId ?? directGroup?.id ?? '';
      collectFromEntities(entityChildren.get(outerGroupId) ?? []);
    } else {
      collectFromEntities(entityChildren.get(cancelledNode.id) ?? []);
    }
  }
  descendantPlanNodeIds.delete(params.cancelledPlanNodeId ?? '');
  if (descendantPlanNodeIds.size === 0) return;

  const instantiated = await getInstantiatedSteps(params.boardId, params.rootTicketId);
  for (const [planNodeId, step] of instantiated) {
    if (!descendantPlanNodeIds.has(planNodeId)) continue;
    if (stepSatisfied(step) || step.statusV2 === TicketStatusV2.CANCELLED) {
      continue;
    }
    await ticketRepository.updateTicketStage(
      step.ticketId,
      FLOW_STAGE_NAMES.CANCELLED,
      params.actorUserId,
      undefined,
      undefined,
      { cascadeFlow: false }
    );
    logger.info(
      `[flowCascade] cascade-cancelled ticket=${step.ticketId} planNode=${planNodeId} run=${params.rootTicketId}`
    );
  }
}
