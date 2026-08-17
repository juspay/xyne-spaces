import type { FlowPlanDecision, FlowPlanGroup, FlowPlanNode } from '@xyne/shared';

export interface DecisionGraphState {
  nodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
  decisions: FlowPlanDecision[];
  detachedIds: ReadonlySet<string>;
}

export interface DecisionGraphResult extends Omit<DecisionGraphState, 'detachedIds'> {
  detachedIds: Set<string>;
}

function updateDetachedTarget(
  detachedIds: Set<string>,
  targetId: string | undefined,
  nodes: FlowPlanNode[],
  groups: FlowPlanGroup[],
): void {
  if (!targetId) return;
  const node = nodes.find(candidate => candidate.id === targetId);
  const group = groups.find(candidate => candidate.id === targetId);
  if (
    (node && !node.groupId && node.parentIds.length === 0) ||
    (group && !group.groupId && group.parentIds.length === 0)
  ) {
    detachedIds.add(targetId);
  } else {
    detachedIds.delete(targetId);
  }
}

/** Disconnect all destinations when a decision's field replaces its route set. */
export function disconnectDecisionTargets(
  state: DecisionGraphState,
  decisionId: string,
): DecisionGraphResult {
  const decision = state.decisions.find(candidate => candidate.id === decisionId);
  const sourceGroupId =
    state.nodes.find(node => node.id === decision?.parentNodeId)?.groupId ?? null;
  const affected = new Set<string>();
  const nodes = state.nodes.map(node => {
    if ((node.groupId ?? null) !== sourceGroupId || !node.parentIds.includes(decisionId))
      return node;
    affected.add(node.id);
    return { ...node, parentIds: node.parentIds.filter(parentId => parentId !== decisionId) };
  });
  const groups = state.groups.map(group => {
    if ((group.groupId ?? null) !== sourceGroupId || !group.parentIds.includes(decisionId))
      return group;
    affected.add(group.id);
    return { ...group, parentIds: group.parentIds.filter(parentId => parentId !== decisionId) };
  });
  const detachedIds = new Set(state.detachedIds);
  for (const targetId of affected) updateDetachedTarget(detachedIds, targetId, nodes, groups);
  return { nodes, groups, decisions: state.decisions, detachedIds };
}

/** Reassign one route while preserving every destination's connection state. */
export function reassignDecisionRoute(
  state: DecisionGraphState,
  decisionId: string,
  routeKey: string,
  targetId: string,
): DecisionGraphResult {
  const decision = state.decisions.find(candidate => candidate.id === decisionId);
  if (!decision) return { ...state, detachedIds: new Set(state.detachedIds) };

  const oldTargetId = decision.routes.find(route => route.key === routeKey)?.targetId;
  const oldStillUsed = decision.routes.some(
    route => route.key !== routeKey && route.targetId === oldTargetId,
  );
  const nodes = state.nodes.map(node => {
    if (node.id === targetId) return { ...node, parentIds: [decisionId] };
    if (node.id === oldTargetId && !oldStillUsed) {
      return { ...node, parentIds: node.parentIds.filter(parentId => parentId !== decisionId) };
    }
    return node;
  });
  const groups = state.groups.map(group => {
    if (group.id === targetId) return { ...group, parentIds: [decisionId] };
    if (group.id === oldTargetId && !oldStillUsed) {
      return { ...group, parentIds: group.parentIds.filter(parentId => parentId !== decisionId) };
    }
    return group;
  });
  const decisions = state.decisions.map(candidate =>
    candidate.id === decisionId
      ? {
          ...candidate,
          routes: candidate.routes.map(route =>
            route.key === routeKey ? { ...route, targetId } : route,
          ),
        }
      : candidate,
  );
  const detachedIds = new Set(state.detachedIds);
  detachedIds.delete(targetId);
  if (!oldStillUsed) updateDetachedTarget(detachedIds, oldTargetId, nodes, groups);
  return { nodes, groups, decisions, detachedIds };
}
