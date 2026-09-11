import {
  FlowPlanModel,
  type FlowPlanDecision,
  type FlowPlanGroup,
  type FlowPlanNode,
} from '@xyne/shared';
import { wouldCreateCycle } from './FlowPlanEditor.utils';

export interface FlowGroupGraphState {
  nodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
}

export type MoveStepResult =
  | { ok: true; state: FlowGroupGraphState }
  | { ok: false; reason: 'missing' | 'same' | 'missing-target' | 'cycle' | 'scope' };

export const groupIsWithin = (
  groupById: ReadonlyMap<string, FlowPlanGroup>,
  groupId: string,
  ancestorGroupId: string,
): boolean => {
  let currentId: string | null = groupId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    if (currentId === ancestorGroupId) return true;
    seen.add(currentId);
    currentId = groupById.get(currentId)?.groupId ?? null;
  }
  return false;
};

/** Direct selections plus everything contained by a selected group cover. */
const selectionBoundaryIds = (
  state: FlowGroupGraphState,
  selectedIds: ReadonlySet<string>,
): Set<string> => {
  const groupById = new Map(state.groups.map(group => [group.id, group]));
  const selectedGroupIds = [...selectedIds].filter(id => groupById.has(id));
  const belongsToSelectedGroup = (groupId: string | null | undefined): boolean =>
    !!groupId &&
    selectedGroupIds.some(selectedGroupId => groupIsWithin(groupById, groupId, selectedGroupId));
  return new Set([
    ...selectedIds,
    ...state.groups.filter(group => belongsToSelectedGroup(group.id)).map(group => group.id),
    ...state.nodes.filter(node => belongsToSelectedGroup(node.groupId)).map(node => node.id),
  ]);
};

/**
 * Remove a group cover while preserving the graph at its destination scope.
 * Outside children reconnect to terminal direct entities so a surviving child
 * group remains an external graph boundary instead of leaking its member IDs.
 */
export interface UngroupFlowGroupResult {
  state: FlowGroupGraphState;
  detachedIds: Set<string>;
}

export function ungroupFlowGroup(
  state: FlowGroupGraphState,
  groupId: string,
  decisions: FlowPlanDecision[],
  detachedIds: ReadonlySet<string>,
): UngroupFlowGroupResult | null {
  const group = state.groups.find(candidate => candidate.id === groupId);
  if (!group) return null;
  const destinationGroupId = group.groupId ?? null;
  const nodeById = new Map(state.nodes.map(node => [node.id, node]));
  const groupById = new Map(state.groups.map(candidate => [candidate.id, candidate]));
  const terminals = new FlowPlanModel({
    version: 2,
    nodes: state.nodes,
    groups: state.groups,
    decisions,
    updatedAt: 0,
  }).terminalEntityIdsOf(groupId);

  // Resolve a stale reference below this cover to the child entity that will
  // be promoted into the removed group's destination scope.
  const promotedBoundaryOf = (entityId: string): string | null => {
    const entity = nodeById.get(entityId) ?? groupById.get(entityId);
    const entityScopeId = entity?.groupId ?? null;
    if (!entityScopeId) return null;
    if (entityScopeId === groupId) return entityId;
    let currentId: string | null = entityScopeId;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const current = groupById.get(currentId);
      if (!current) return null;
      if (current.groupId === groupId) return current.id;
      currentId = current.groupId ?? null;
    }
    return null;
  };
  const normalizeOutsideParents = (parentIds: string[]): string[] => {
    const normalized = [
      ...new Set(
        parentIds.flatMap(parentId => {
          if (parentId === groupId) return terminals;
          return [promotedBoundaryOf(parentId) ?? parentId];
        }),
      ),
    ];
    return normalized.length === parentIds.length &&
      normalized.every((parentId, index) => parentId === parentIds[index])
      ? parentIds
      : normalized;
  };
  const nodeIsInside = (node: FlowPlanNode): boolean =>
    !!node.groupId && groupIsWithin(groupById, node.groupId, groupId);
  const groupIsInside = (candidate: FlowPlanGroup): boolean =>
    !!candidate.groupId && groupIsWithin(groupById, candidate.groupId, groupId);

  const nextState = {
    nodes: state.nodes.map(node => {
      if (node.groupId === groupId) {
        return {
          ...node,
          groupId: destinationGroupId,
          parentIds: node.parentIds.length > 0 ? node.parentIds : [...group.parentIds],
        };
      }
      if (nodeIsInside(node)) return node;
      const parentIds = normalizeOutsideParents(node.parentIds);
      return parentIds === node.parentIds ? node : { ...node, parentIds };
    }),
    groups: state.groups
      .filter(candidate => candidate.id !== groupId)
      .map(candidate => {
        if (candidate.groupId === groupId) {
          return {
            ...candidate,
            groupId: destinationGroupId,
            parentIds: candidate.parentIds.length > 0 ? candidate.parentIds : [...group.parentIds],
          };
        }
        if (groupIsInside(candidate)) return candidate;
        const parentIds = normalizeOutsideParents(candidate.parentIds);
        return parentIds === candidate.parentIds ? candidate : { ...candidate, parentIds };
      }),
  };
  const nextDetachedIds = new Set(detachedIds);
  const groupWasDetached = nextDetachedIds.delete(groupId);
  if (groupWasDetached && !destinationGroupId && group.parentIds.length === 0) {
    for (const node of state.nodes) {
      if (node.groupId === groupId && node.parentIds.length === 0) {
        nextDetachedIds.add(node.id);
      }
    }
    for (const childGroup of state.groups) {
      if (childGroup.groupId === groupId && childGroup.parentIds.length === 0) {
        nextDetachedIds.add(childGroup.id);
      }
    }
  }
  return { state: nextState, detachedIds: nextDetachedIds };
}

export type CreateGroupReason =
  | 'empty'
  | 'mixed-scope'
  | 'entry-parents'
  | 'not-contiguous'
  | 'decision-incomplete'
  | 'depth'
  | 'cycle'
  | 'mixed-detached';

export type CreateGroupResult =
  | { ok: true; state: FlowGroupGraphState; detachedIds: Set<string> }
  | { ok: false; reason: CreateGroupReason };

interface CreateGroupOptions {
  entityIds: string[];
  selectedDecisionIds: string[];
  decisions: FlowPlanDecision[];
  detachedIds: ReadonlySet<string>;
  groupId: string;
  name: string;
}

const sameIds = (left: string[], right: string[]): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
};

const replaceSelectedParents = (
  parentIds: string[],
  selectedIds: ReadonlySet<string>,
  groupId: string,
): string[] => {
  if (!parentIds.some(parentId => selectedIds.has(parentId))) return parentIds;
  return [...new Set(parentIds.map(parentId => (selectedIds.has(parentId) ? groupId : parentId)))];
};

/**
 * Wrap a rectangular selection in one group while preserving the outer DAG.
 * The first selected row becomes the group's entry, and every outside child
 * that depended on the selected region depends on the group instead.
 */
export function createGroupFromSelection(
  state: FlowGroupGraphState,
  options: CreateGroupOptions,
): CreateGroupResult {
  const nodeById = new Map(state.nodes.map(node => [node.id, node]));
  const groupById = new Map(state.groups.map(group => [group.id, group]));
  const decisionById = new Map(options.decisions.map(decision => [decision.id, decision]));
  const selectedIds = new Set(
    options.entityIds.filter(id => nodeById.has(id) || groupById.has(id)),
  );
  const selectedDecisionIds = new Set(options.selectedDecisionIds);
  if (selectedIds.size === 0) return { ok: false, reason: 'empty' };
  const selectedBoundaryIds = selectionBoundaryIds(state, selectedIds);

  const entityOf = (id: string): FlowPlanNode | FlowPlanGroup | undefined =>
    nodeById.get(id) ?? groupById.get(id);
  const scopes = new Set([...selectedIds].map(id => entityOf(id)?.groupId ?? null));
  if (scopes.size !== 1) return { ok: false, reason: 'mixed-scope' };
  const scopeId = [...scopes][0] ?? null;

  // A selected group becomes a child of the new group. That is only legal at
  // the top level and when the selected group has no child group of its own.
  const selectedGroups = [...selectedIds].flatMap(id => (groupById.has(id) ? [id] : []));
  if (
    selectedGroups.some(
      groupId => scopeId !== null || state.groups.some(group => group.groupId === groupId),
    )
  ) {
    return { ok: false, reason: 'depth' };
  }

  for (const decision of options.decisions) {
    const touched =
      selectedDecisionIds.has(decision.id) ||
      selectedIds.has(decision.parentNodeId) ||
      decision.routes.some(route => selectedIds.has(route.targetId));
    if (!touched) continue;
    const complete =
      selectedDecisionIds.has(decision.id) &&
      selectedIds.has(decision.parentNodeId) &&
      decision.routes.every(route => !!route.targetId && selectedIds.has(route.targetId));
    if (!complete) return { ok: false, reason: 'decision-incomplete' };
  }

  const effectiveParentsOf = (id: string): string[] =>
    (entityOf(id)?.parentIds ?? []).map(
      parentId => decisionById.get(parentId)?.parentNodeId ?? parentId,
    );
  const entryIds: string[] = [];
  const entryParentIds = new Map<string, string[]>();
  const childrenBySelectedParent = new Map<string, string[]>();

  for (const id of selectedIds) {
    const entity = entityOf(id)!;
    const effectiveParents = effectiveParentsOf(id);
    const internalParents = effectiveParents.filter(parentId => selectedIds.has(parentId));
    const externalParents = entity.parentIds.filter(
      (_, index) => !selectedIds.has(effectiveParents[index]!),
    );
    if (internalParents.length > 0 && externalParents.length > 0) {
      return { ok: false, reason: 'not-contiguous' };
    }
    if (internalParents.length === 0) {
      entryIds.push(id);
      entryParentIds.set(id, externalParents);
    }
    for (const parentId of internalParents) {
      const children = childrenBySelectedParent.get(parentId) ?? [];
      children.push(id);
      childrenBySelectedParent.set(parentId, children);
    }
  }

  const firstEntryParents = entryParentIds.get(entryIds[0] ?? '') ?? [];
  if (
    entryIds.length === 0 ||
    entryIds.some(id => !sameIds(entryParentIds.get(id) ?? [], firstEntryParents))
  ) {
    return { ok: false, reason: 'entry-parents' };
  }

  const reachable = new Set(entryIds);
  const queue = [...entryIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenBySelectedParent.get(current) ?? []) {
      if (reachable.has(childId)) continue;
      reachable.add(childId);
      queue.push(childId);
    }
  }
  if (reachable.size !== selectedIds.size) {
    return { ok: false, reason: 'not-contiguous' };
  }

  const topLevelRootEntries = entryIds.filter(
    id => !entityOf(id)?.groupId && (entityOf(id)?.parentIds.length ?? 0) === 0,
  );
  const detachedEntryCount = topLevelRootEntries.filter(id => options.detachedIds.has(id)).length;
  if (detachedEntryCount > 0 && detachedEntryCount !== topLevelRootEntries.length) {
    return { ok: false, reason: 'mixed-detached' };
  }
  const groupDetached =
    topLevelRootEntries.length === entryIds.length && detachedEntryCount === entryIds.length;
  const entryIdSet = new Set(entryIds);
  const selectedOrder = [...selectedIds].map(id => {
    const node = nodeById.get(id);
    if (node) return node.order;
    const group = groupById.get(id)!;
    if (group.order !== undefined) return group.order;
    const descendantOrders = state.nodes
      .filter(node => node.groupId === group.id)
      .map(node => node.order);
    return descendantOrders.length > 0 ? Math.min(...descendantOrders) : 0;
  });
  const newGroup: FlowPlanGroup = {
    id: options.groupId,
    name: options.name,
    parentIds: [...firstEntryParents],
    order: Math.min(...selectedOrder),
    ...(scopeId && { groupId: scopeId }),
  };

  const nodes = state.nodes.map(node => {
    if (selectedIds.has(node.id)) {
      return {
        ...node,
        groupId: options.groupId,
        parentIds: entryIdSet.has(node.id) ? [] : node.parentIds,
      };
    }
    if (selectedBoundaryIds.has(node.id)) return node;
    const parentIds = replaceSelectedParents(node.parentIds, selectedBoundaryIds, options.groupId);
    return parentIds === node.parentIds ? node : { ...node, parentIds };
  });
  const groups = [
    ...state.groups.map(group => {
      if (selectedIds.has(group.id)) {
        return {
          ...group,
          groupId: options.groupId,
          parentIds: entryIdSet.has(group.id) ? [] : group.parentIds,
        };
      }
      if (selectedBoundaryIds.has(group.id)) return group;
      const parentIds = replaceSelectedParents(
        group.parentIds,
        selectedBoundaryIds,
        options.groupId,
      );
      return parentIds === group.parentIds ? group : { ...group, parentIds };
    }),
    newGroup,
  ];

  const outsideChildren = [
    ...nodes.filter(
      node => !selectedBoundaryIds.has(node.id) && node.parentIds.includes(options.groupId),
    ),
    ...groups.filter(
      group =>
        group.id !== options.groupId &&
        !selectedBoundaryIds.has(group.id) &&
        group.parentIds.includes(options.groupId),
    ),
  ];
  if (outsideChildren.some(child => wouldCreateCycle(nodes, groups, child.id, options.groupId))) {
    return { ok: false, reason: 'cycle' };
  }

  const detachedIds = new Set(options.detachedIds);
  selectedIds.forEach(id => detachedIds.delete(id));
  if (groupDetached) detachedIds.add(options.groupId);
  return { ok: true, state: { nodes, groups }, detachedIds };
}

/** Persist left-to-right order only among entities with the same scope and parents. */
export function reorderSiblingEntities(
  state: FlowGroupGraphState,
  entityId: string,
  centerXById: ReadonlyMap<string, number>,
): FlowGroupGraphState {
  const dragged =
    state.nodes.find(node => node.id === entityId) ??
    state.groups.find(group => group.id === entityId);
  if (!dragged) return state;
  const scopeId = dragged.groupId ?? null;
  const siblings = [...state.nodes, ...state.groups].filter(
    entity => (entity.groupId ?? null) === scopeId && sameIds(entity.parentIds, dragged.parentIds),
  );
  if (siblings.length < 2 || !centerXById.has(entityId)) return state;
  const fallbackOrder = (entity: FlowPlanNode | FlowPlanGroup): number =>
    'title' in entity ? entity.order : (entity.order ?? 0);
  siblings.sort((left, right) => {
    const leftX = centerXById.get(left.id);
    const rightX = centerXById.get(right.id);
    if (leftX !== undefined && rightX !== undefined) return leftX - rightX;
    if (leftX !== undefined) return -1;
    if (rightX !== undefined) return 1;
    return fallbackOrder(left) - fallbackOrder(right);
  });
  const orderById = new Map(siblings.map((entity, index) => [entity.id, index]));
  return {
    nodes: state.nodes.map(node =>
      orderById.has(node.id) && node.order !== orderById.get(node.id)
        ? { ...node, order: orderById.get(node.id)! }
        : node,
    ),
    groups: state.groups.map(group =>
      orderById.has(group.id) && group.order !== orderById.get(group.id)
        ? { ...group, order: orderById.get(group.id)! }
        : group,
    ),
  };
}

/**
 * Move a step between group scopes without exposing an entity below a group
 * boundary to an owner outside that boundary.
 */
export function moveStepToContainer(
  state: FlowGroupGraphState,
  stepId: string,
  targetGroupId: string | null,
  decisions: FlowPlanDecision[],
): MoveStepResult {
  const step = state.nodes.find(candidate => candidate.id === stepId);
  if (!step) return { ok: false, reason: 'missing' };
  const currentGroupId = step.groupId ?? null;
  if (currentGroupId === targetGroupId) return { ok: false, reason: 'same' };

  const nodeById = new Map(state.nodes.map(candidate => [candidate.id, candidate]));
  const groupById = new Map(state.groups.map(group => [group.id, group]));
  const decisionById = new Map(decisions.map(decision => [decision.id, decision]));
  if (targetGroupId && !groupById.has(targetGroupId)) {
    return { ok: false, reason: 'missing-target' };
  }

  if (targetGroupId) {
    const dependents = [
      ...state.nodes.filter(
        candidate =>
          (candidate.groupId ?? null) !== targetGroupId && candidate.parentIds.includes(step.id),
      ),
      ...state.groups.filter(group => group.parentIds.includes(step.id)),
    ];
    if (
      dependents.some(dependent =>
        wouldCreateCycle(state.nodes, state.groups, dependent.id, targetGroupId),
      )
    ) {
      return { ok: false, reason: 'cycle' };
    }
  }

  const scopeOf = (entityId: string): string | null | undefined => {
    const node = nodeById.get(entityId);
    if (node) return node.groupId ?? null;
    const group = groupById.get(entityId);
    if (group) return group.groupId ?? null;
    const decision = decisionById.get(entityId);
    if (!decision) return undefined;
    return nodeById.get(decision.parentNodeId)?.groupId ?? null;
  };

  // Resolve an entity to the nearest group cover visible from an owner's
  // scope. For example, a nested group is seen as its outer group by a
  // top-level dependent.
  const projectToScope = (entityId: string, ownerScopeId: string | null): string | null => {
    const entityScopeId = scopeOf(entityId);
    if (entityScopeId === undefined) return null;
    if (entityScopeId === ownerScopeId) return entityId;

    let containingGroupId: string | null = entityScopeId;
    const seen = new Set<string>();
    while (containingGroupId && !seen.has(containingGroupId)) {
      seen.add(containingGroupId);
      const containingGroup = groupById.get(containingGroupId);
      if (!containingGroup) return null;
      if ((containingGroup.groupId ?? null) === ownerScopeId) return containingGroup.id;
      containingGroupId = containingGroup.groupId ?? null;
    }
    return null;
  };

  let movedParentIds: string[] = [];
  if (currentGroupId && !targetGroupId) {
    const model = new FlowPlanModel({
      version: 2,
      nodes: state.nodes,
      groups: state.groups,
      decisions,
      updatedAt: 0,
    });
    const projectedParents = model
      .effectiveGroupParentIds(currentGroupId)
      .map(parentId => projectToScope(parentId, null));
    if (projectedParents.some(parentId => parentId === null)) {
      return { ok: false, reason: 'scope' };
    }
    movedParentIds = [
      ...new Set(projectedParents.filter((parentId): parentId is string => parentId !== null)),
    ];
  }

  let invalidScope = false;
  const remapDependentParents = (
    parentIds: string[],
    ownerId: string,
    ownerScopeId: string | null,
  ): string[] => {
    if (!targetGroupId || !parentIds.includes(step.id)) return parentIds;
    const replacementId = projectToScope(targetGroupId, ownerScopeId);
    if (!replacementId) {
      invalidScope = true;
      return parentIds;
    }
    return [
      ...new Set(parentIds.map(parentId => (parentId === step.id ? replacementId : parentId))),
    ].filter(parentId => parentId !== ownerId);
  };

  const nodes = state.nodes.map(candidate => {
    if (candidate.id === step.id) {
      return {
        ...candidate,
        groupId: targetGroupId,
        parentIds: targetGroupId ? [] : movedParentIds,
      };
    }
    if (
      currentGroupId &&
      candidate.groupId === currentGroupId &&
      candidate.parentIds.includes(step.id)
    ) {
      return {
        ...candidate,
        parentIds: candidate.parentIds.filter(parentId => parentId !== step.id),
      };
    }
    if ((candidate.groupId ?? null) === targetGroupId) return candidate;
    const parentIds = remapDependentParents(
      candidate.parentIds,
      candidate.id,
      candidate.groupId ?? null,
    );
    return parentIds === candidate.parentIds ? candidate : { ...candidate, parentIds };
  });

  const groups = state.groups.map(group => {
    if (currentGroupId && group.groupId === currentGroupId && group.parentIds.includes(step.id)) {
      return {
        ...group,
        parentIds: group.parentIds.filter(parentId => parentId !== step.id),
      };
    }
    if ((group.groupId ?? null) === targetGroupId) return group;
    const parentIds = remapDependentParents(group.parentIds, group.id, group.groupId ?? null);
    return parentIds === group.parentIds ? group : { ...group, parentIds };
  });

  return invalidScope ? { ok: false, reason: 'scope' } : { ok: true, state: { nodes, groups } };
}

export type MoveGroupResult =
  | { ok: true; state: FlowGroupGraphState }
  | { ok: false; reason: 'missing' | 'same' | 'depth' | 'has-child' | 'cycle' };

/** Move one group into a top-level group, or promote it back to the main flow. */
export function moveGroupToContainer(
  state: FlowGroupGraphState,
  groupId: string,
  targetGroupId: string | null,
): MoveGroupResult {
  const dragged = state.groups.find(group => group.id === groupId);
  if (!dragged) return { ok: false, reason: 'missing' };
  if ((dragged.groupId ?? null) === targetGroupId) return { ok: false, reason: 'same' };

  if (targetGroupId) {
    const target = state.groups.find(group => group.id === targetGroupId);
    if (!target || target.groupId) return { ok: false, reason: 'depth' };
    if (state.groups.some(group => group.groupId === dragged.id)) {
      return { ok: false, reason: 'has-child' };
    }
    if (wouldCreateCycle(state.nodes, state.groups, dragged.id, targetGroupId)) {
      return { ok: false, reason: 'cycle' };
    }
  }

  const currentContainerId = dragged.groupId ?? null;
  const currentContainer = currentContainerId
    ? state.groups.find(group => group.id === currentContainerId)
    : undefined;
  const remap = (parentIds: string[], selfId: string, replacementId: string): string[] =>
    [...new Set(parentIds.map(id => (id === dragged.id ? replacementId : id)))].filter(
      id => id !== selfId,
    );

  const nodes = state.nodes.map(candidate => {
    if (
      currentContainerId &&
      candidate.groupId === currentContainerId &&
      candidate.parentIds.includes(dragged.id)
    ) {
      return {
        ...candidate,
        parentIds: candidate.parentIds.filter(parentId => parentId !== dragged.id),
      };
    }
    if (
      targetGroupId &&
      (candidate.groupId ?? null) !== targetGroupId &&
      candidate.parentIds.includes(dragged.id)
    ) {
      return {
        ...candidate,
        parentIds: remap(candidate.parentIds, candidate.id, targetGroupId),
      };
    }
    return candidate;
  });

  const groups = state.groups.map(candidate => {
    if (candidate.id === dragged.id) {
      return {
        ...candidate,
        groupId: targetGroupId,
        parentIds: targetGroupId ? [] : [...(currentContainer?.parentIds ?? [])],
      };
    }
    if (
      currentContainerId &&
      candidate.groupId === currentContainerId &&
      candidate.parentIds.includes(dragged.id)
    ) {
      return {
        ...candidate,
        parentIds: candidate.parentIds.filter(parentId => parentId !== dragged.id),
      };
    }
    if (
      targetGroupId &&
      (candidate.groupId ?? null) !== targetGroupId &&
      candidate.parentIds.includes(dragged.id)
    ) {
      return {
        ...candidate,
        parentIds: remap(candidate.parentIds, candidate.id, targetGroupId),
      };
    }
    return candidate;
  });

  return { ok: true, state: { nodes, groups } };
}
