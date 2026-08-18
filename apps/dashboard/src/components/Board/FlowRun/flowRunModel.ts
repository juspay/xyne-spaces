import {
  deserializeFlowPlan,
  FlowPlanModel,
  type FlowDecisionOutcome,
  type FlowPlanNode,
  type FlowRunNodeSnapshot,
  TicketStatusV2,
} from '@xyne/shared';
import {
  flowRuntimeStatusOf,
  getFlowMeta,
  isFlowStepBacklogged,
  isRunRoot,
  mapPlanToRunTickets,
  type FlowRunTicket,
} from './flowRun.utils';

export interface FlowRunSummaryStep {
  id: string;
  title: string;
  groupId: string | null;
  groupName: string | null;
}

export interface FlowRunSummary {
  state: 'completed' | 'cancelled' | 'pending' | 'backlog' | 'not-started';
  pending: FlowRunSummaryStep[];
  backlogged: FlowRunSummaryStep[];
  cancelled: FlowRunSummaryStep[];
  completedCount: number;
  totalCount: number;
}

function planNodeFromSnapshot(planNodeId: string, snapshot: FlowRunNodeSnapshot): FlowPlanNode {
  return {
    id: planNodeId,
    title: snapshot.title,
    order: snapshot.order,
    parentIds: snapshot.parentPlanNodeIds,
    gate: snapshot.gate,
    ...(snapshot.description !== undefined && { description: snapshot.description }),
    ...(snapshot.assignedTo !== undefined && { assignedTo: snapshot.assignedTo }),
    ...(snapshot.groupId && { groupId: snapshot.groupId }),
  };
}

/**
 * Reconstructs the model a particular run was created from. Runtime snapshots
 * take precedence over the board's current plan so historical runs remain
 * stable after the plan is edited.
 */
export function buildFlowRunModel(
  currentModel: FlowPlanModel,
  rootTicket: FlowRunTicket,
  runTickets: ReadonlyMap<string, FlowRunTicket>,
): FlowPlanModel {
  let baseModel = currentModel;
  const planSnapshot = getFlowMeta(rootTicket)?.planSnapshot;
  if (planSnapshot) {
    try {
      baseModel = new FlowPlanModel(deserializeFlowPlan(planSnapshot));
    } catch {
      baseModel = currentModel;
    }
  } else if (
    rootTicket.statusV2 === TicketStatusV2.COMPLETED ||
    rootTicket.statusV2 === TicketStatusV2.CANCELLED
  ) {
    baseModel = new FlowPlanModel({
      version: 2,
      nodes: [],
      groups: [],
      decisions: [],
      updatedAt: currentModel.plan.updatedAt,
    });
  }

  const snapshots = new Map<string, FlowRunNodeSnapshot>();
  for (const [planNodeId, ticket] of runTickets) {
    const snapshot = getFlowMeta(ticket)?.nodeSnapshot;
    if (snapshot) snapshots.set(planNodeId, snapshot);
  }

  const nodes = baseModel.nodes.map(node => {
    const snapshot = snapshots.get(node.id);
    return snapshot ? planNodeFromSnapshot(node.id, snapshot) : node;
  });
  for (const [planNodeId, snapshot] of snapshots) {
    if (!nodes.some(node => node.id === planNodeId)) {
      nodes.push(planNodeFromSnapshot(planNodeId, snapshot));
    }
  }

  const groups = [...baseModel.groups];
  for (const snapshot of snapshots.values()) {
    if (!snapshot.groupId) continue;
    const currentGroup = baseModel.getGroup(snapshot.groupId);
    const parentGroupId = currentGroup ? currentGroup.groupId : snapshot.groupParentGroupId;
    const group = {
      id: snapshot.groupId,
      name: snapshot.groupName ?? 'Group',
      parentIds: snapshot.groupParentPlanNodeIds ?? [],
      ...(currentGroup?.order !== undefined && { order: currentGroup.order }),
      ...(parentGroupId && { groupId: parentGroupId }),
    };
    const index = groups.findIndex(candidate => candidate.id === group.id);
    if (index >= 0) groups[index] = group;
    else groups.push(group);
    if (snapshot.groupParentGroupId && parentGroupId === snapshot.groupParentGroupId) {
      const currentParentGroup = baseModel.getGroup(snapshot.groupParentGroupId);
      const parentGroup = {
        id: snapshot.groupParentGroupId,
        name: snapshot.groupParentGroupName ?? 'Group',
        parentIds: snapshot.groupParentGroupParentPlanNodeIds ?? [],
        ...(currentParentGroup?.order !== undefined && { order: currentParentGroup.order }),
      };
      const parentIndex = groups.findIndex(candidate => candidate.id === parentGroup.id);
      if (parentIndex >= 0) groups[parentIndex] = parentGroup;
      else groups.push(parentGroup);
    }
  }

  const model = new FlowPlanModel({ ...baseModel.plan, nodes, groups });
  const decisionOutcomes = new Map<string, FlowDecisionOutcome>();
  for (const decision of model.decisions) {
    const outcome = getFlowMeta(runTickets.get(decision.parentNodeId) ?? {})?.decisionOutcomes?.[
      decision.id
    ];
    if (outcome) decisionOutcomes.set(decision.id, outcome);
  }
  return model.withResolvedDecisionTargets(decisionOutcomes);
}

export function runPlanNode(
  model: FlowPlanModel,
  planNodeId: string,
  ticket: FlowRunTicket,
): FlowPlanNode | undefined {
  const snapshot = getFlowMeta(ticket)?.nodeSnapshot;
  return snapshot ? planNodeFromSnapshot(planNodeId, snapshot) : model.getNode(planNodeId);
}

export function sameFlowPlanNode(left: FlowPlanNode | null, right: FlowPlanNode | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.description === right.description &&
    left.assignedTo === right.assignedTo &&
    left.order === right.order &&
    left.groupId === right.groupId &&
    left.parentIds.length === right.parentIds.length &&
    left.parentIds.every((id, index) => id === right.parentIds[index]) &&
    JSON.stringify(left.gate ?? null) === JSON.stringify(right.gate ?? null)
  );
}

export function sameFlowRunTicket(
  left: FlowRunTicket | null,
  right: FlowRunTicket | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.xyneId === right.xyneId &&
    left.statusV2 === right.statusV2 &&
    left.stageName === right.stageName &&
    left.assignedTo === right.assignedTo &&
    left.channelId === right.channelId &&
    left.conversationId === right.conversationId &&
    left.metadata === right.metadata
  );
}

export function summarizeFlowRuns(
  currentModel: FlowPlanModel,
  tickets: readonly FlowRunTicket[],
): Map<string, FlowRunSummary> {
  const summaries = new Map<string, FlowRunSummary>();
  for (const ticket of tickets) {
    if (!isRunRoot(ticket)) continue;
    const runTickets = mapPlanToRunTickets(tickets, ticket.id);
    const model = buildFlowRunModel(currentModel, ticket, runTickets);
    const statuses = new Map(
      [...runTickets].map(([planNodeId, runTicket]) => [
        planNodeId,
        flowRuntimeStatusOf(runTicket),
      ]),
    );
    const decisionOutcomes = new Map<string, FlowDecisionOutcome>();
    for (const decision of model.decisions) {
      const outcome = getFlowMeta(runTickets.get(decision.parentNodeId) ?? {})?.decisionOutcomes?.[
        decision.id
      ];
      if (outcome) decisionOutcomes.set(decision.id, outcome);
    }
    const skippedNodeIds = model.skippedPlanNodeIds(
      statuses,
      ticket.statusV2 === TicketStatusV2.CANCELLED,
      decisionOutcomes,
    );
    const nodes = model.nodes.filter(node => !skippedNodeIds.has(node.id));
    const totalCount = nodes.length;
    const completedCount = nodes.filter(
      node => runTickets.get(node.id)?.statusV2 === TicketStatusV2.COMPLETED,
    ).length;
    const toSummaryStep = (node: FlowPlanNode): FlowRunSummaryStep => {
      const runTicket = runTickets.get(node.id);
      return {
        id: node.id,
        title: runTicket?.title ?? node.title,
        groupId: node.groupId ?? null,
        groupName: node.groupId
          ? (getFlowMeta(runTicket ?? {})?.nodeSnapshot?.groupName ??
            model.getGroup(node.groupId)?.name ??
            null)
          : null,
      };
    };
    const cancelled = nodes
      .filter(node => runTickets.get(node.id)?.statusV2 === TicketStatusV2.CANCELLED)
      .map(toSummaryStep);
    if (
      ticket.statusV2 === TicketStatusV2.COMPLETED ||
      ticket.statusV2 === TicketStatusV2.CANCELLED
    ) {
      summaries.set(ticket.id, {
        state: ticket.statusV2 === TicketStatusV2.COMPLETED ? 'completed' : 'cancelled',
        pending: [],
        backlogged: [],
        cancelled,
        completedCount,
        totalCount,
      });
      continue;
    }
    const pending = nodes
      .filter(node => {
        const stepTicket = runTickets.get(node.id);
        return (
          !!stepTicket &&
          !isFlowStepBacklogged(stepTicket) &&
          (stepTicket.statusV2 === TicketStatusV2.PAUSED ||
            stepTicket.statusV2 === TicketStatusV2.STARTED)
        );
      })
      .map(toSummaryStep);
    const backlogged = nodes
      .filter(node => isFlowStepBacklogged(runTickets.get(node.id)))
      .map(toSummaryStep);
    summaries.set(ticket.id, {
      state: pending.length > 0 ? 'pending' : backlogged.length > 0 ? 'backlog' : 'not-started',
      pending,
      backlogged,
      cancelled,
      completedCount,
      totalCount,
    });
  }
  return summaries;
}
