import {
  FLOW_STAGE_NAMES,
  TicketStatusV2,
  type FlowDecisionOutcome,
  type FlowPlanModel,
  type FlowPlanNode,
  type FlowRunNodeSnapshot,
} from '@xyne/shared';

export interface FlowRunTicket {
  id: string;
  xyneId: string;
  title: string;
  statusV2: TicketStatusV2;
  stageName?: string | null;
  assignedTo?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  updatedAt?: number | null;
  updatedBy?: string | null;
  statusUpdatedAt?: number | null;
  metadata?: unknown;
}

export interface FlowTicketMeta {
  planNodeId?: string;
  rootTicketId?: string;
  planSnapshot?: string;
  nodeSnapshot?: FlowRunNodeSnapshot;
  decisionOutcomes?: Record<string, FlowDecisionOutcome>;
}

export function getFlowMeta(ticket: { metadata?: unknown }): FlowTicketMeta | undefined {
  const metadata = ticket.metadata as { flow?: FlowTicketMeta } | null | undefined;
  return metadata?.flow ?? undefined;
}

export function isRunRoot(ticket: { metadata?: unknown }): boolean {
  return !getFlowMeta(ticket)?.planNodeId;
}

export function isFlowStepBacklogged(ticket?: { stageName?: string | null } | null): boolean {
  return ticket?.stageName === FLOW_STAGE_NAMES.BACKLOG;
}

export function flowRuntimeStatusOf(ticket: FlowRunTicket): TicketStatusV2 {
  return isFlowStepBacklogged(ticket) ? TicketStatusV2.COMPLETED : ticket.statusV2;
}

export function mapPlanToRunTickets<T extends { metadata?: unknown }>(
  tickets: readonly T[],
  runId: string,
): Map<string, T> {
  const byPlanNodeId = new Map<string, T>();
  for (const ticket of tickets) {
    const flow = getFlowMeta(ticket);
    if (flow?.planNodeId && flow.rootTicketId === runId) {
      byPlanNodeId.set(flow.planNodeId, ticket);
    }
  }
  return byPlanNodeId;
}

/**
 * Picks the next waiting step without abandoning unfinished group work.
 * Within the allowed scope, shared traversal order moves breadth-first across
 * each visible row, then left-to-right, then through a group's internal work.
 */
export function nextFlowWaitingNode(
  model: FlowPlanModel,
  candidates: readonly FlowPlanNode[],
  currentNode: FlowPlanNode | null,
  statusByNodeId: ReadonlyMap<string, string>,
  skippedNodeIds: ReadonlySet<string>,
): FlowPlanNode | undefined {
  const planIndex = new Map(model.nodes.map((node, index) => [node.id, index]));
  const ordered = [...candidates].sort((left, right) => {
    const orderDifference = model.compareTraversalOrder(left.id, right.id);
    if (orderDifference !== 0) return orderDifference;
    return (planIndex.get(left.id) ?? 0) - (planIndex.get(right.id) ?? 0);
  });

  if (!currentNode?.groupId) return ordered[0];
  for (const groupId of model.groupAndAncestorIds(currentNode.groupId)) {
    const status = model.deriveGroupStatus(groupId, statusByNodeId, skippedNodeIds);
    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'SKIPPED') continue;
    return ordered.find(candidate => {
      if (!candidate.groupId) return false;
      return model.groupAndAncestorIds(candidate.groupId).includes(groupId);
    });
  }
  return ordered[0];
}

export function normalizeUserId(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.startsWith('user:') ? value.slice('user:'.length) : value;
}
