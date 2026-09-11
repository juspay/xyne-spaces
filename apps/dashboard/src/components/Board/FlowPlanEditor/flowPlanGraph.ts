import type { FlowPlanDecision, FlowPlanGroup, FlowPlanNode } from '@xyne/shared';
import type { Connection } from 'reactflow';
import { GROUP_ENTRY_HANDLE, GROUP_EXIT_HANDLE } from '../FlowRun/FlowGroupNode';
import { wouldCreateCycle } from './FlowPlanEditor.utils';

export interface PlanState {
  nodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
}

// Step nodes use the plan node id; group covers use a prefixed canvas id.
export const coverId = (groupId: string): string => `group:${groupId}`;
export const isCoverId = (id: string): boolean => id.startsWith('group:');
export const planIdOf = (canvasId: string): string =>
  isCoverId(canvasId) ? canvasId.slice('group:'.length) : canvasId;

/**
 * Resolves a vertical connection by the border each end used. ReactFlow's
 * source/target roles cannot express the dual handles on a group cover.
 */
export function resolveParentChild(
  connection: Connection,
): { parentId: string; childId: string } | null {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target) return null;
  const sourceAtBottom = sourceHandle !== GROUP_ENTRY_HANDLE;
  const targetAtBottom = targetHandle === GROUP_EXIT_HANDLE;
  if (sourceAtBottom === targetAtBottom) return null;
  const parentCanvasId = sourceAtBottom ? source : target;
  const childCanvasId = sourceAtBottom ? target : source;
  return { parentId: planIdOf(parentCanvasId), childId: planIdOf(childCanvasId) };
}

export function parentsInState(state: PlanState, planId: string): string[] | null {
  const step = state.nodes.find(node => node.id === planId);
  if (step) return step.parentIds;
  const group = state.groups.find(candidate => candidate.id === planId);
  return group ? group.parentIds : null;
}

export function withParents(state: PlanState, planId: string, parentIds: string[]): PlanState {
  if (state.nodes.some(node => node.id === planId)) {
    return {
      ...state,
      nodes: state.nodes.map(node => (node.id === planId ? { ...node, parentIds } : node)),
    };
  }
  return {
    ...state,
    groups: state.groups.map(group => (group.id === planId ? { ...group, parentIds } : group)),
  };
}

export type AddLinkResult =
  | { ok: true; state: PlanState }
  | { ok: false; reason: 'invalid' | 'exists' | 'cross-group' | 'cycle' };

export function addLink(state: PlanState, sourceId: string, targetId: string): AddLinkResult {
  if (sourceId === targetId) return { ok: false, reason: 'invalid' };
  const sourceStep = state.nodes.find(node => node.id === sourceId);
  const targetStep = state.nodes.find(node => node.id === targetId);
  const sourceGroupId =
    sourceStep?.groupId ?? state.groups.find(group => group.id === sourceId)?.groupId ?? null;
  const targetGroupId =
    targetStep?.groupId ?? state.groups.find(group => group.id === targetId)?.groupId ?? null;
  if ((sourceGroupId || targetGroupId) && sourceGroupId !== targetGroupId) {
    return { ok: false, reason: 'cross-group' };
  }
  const parents = parentsInState(state, targetId);
  if (parents === null) return { ok: false, reason: 'invalid' };
  if (parents.includes(sourceId)) return { ok: false, reason: 'exists' };
  if (wouldCreateCycle(state.nodes, state.groups, targetId, sourceId)) {
    return { ok: false, reason: 'cycle' };
  }
  return { ok: true, state: withParents(state, targetId, [...parents, sourceId]) };
}

export function memberGroupOf(state: PlanState, planId: string): string | null {
  return (
    state.nodes.find(node => node.id === planId)?.groupId ??
    state.groups.find(group => group.id === planId)?.groupId ??
    null
  );
}

export function removeLink(state: PlanState, sourceId: string, targetId: string): PlanState {
  const parents = parentsInState(state, targetId);
  if (!parents || !parents.includes(sourceId)) return state;
  return withParents(
    state,
    targetId,
    parents.filter(parentId => parentId !== sourceId),
  );
}

export function withoutStaleDecisionParents(
  state: PlanState,
  targetId: string,
  decisions: FlowPlanDecision[],
): PlanState {
  const decisionById = new Map(decisions.map(decision => [decision.id, decision]));
  const parents = parentsInState(state, targetId);
  if (!parents) return state;
  const nextParents = parents.filter(parentId => {
    const decision = decisionById.get(parentId);
    return !decision || decision.routes.some(route => route.targetId === targetId);
  });
  return nextParents.length === parents.length ? state : withParents(state, targetId, nextParents);
}
