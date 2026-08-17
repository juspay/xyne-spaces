/** FLOW plan types, validation, legacy normalization, and shared read model. */

import { z } from 'zod';

export type FlowStepGate =
  | { type: 'confirmation'; prompt?: string }
  | { type: 'form'; formId: string };

/** Named sub-flow that behaves as one outer-DAG entity. */
export interface FlowPlanGroup {
  id: string;
  name: string;
  parentIds: string[];
  /** Stable left-to-right position among sibling steps/groups. */
  order?: number;
  /** Optional containing group. Only one nested level is supported. */
  groupId?: string | null;
}

export interface FlowPlanNode {
  id: string;
  title: string;
  description?: string;
  assignedTo?: string | null;
  /**
   * A step may have several parents; at runtime it is only created once ALL
   * parents are completed. Ungrouped steps: ungrouped step ids or group ids
   * (empty = direct child of the run's main ticket). Grouped steps: member
   * ids of the same group only (empty = entry row, starts with the group).
   */
  parentIds: string[];
  order: number;
  gate?: FlowStepGate;
  groupId?: string | null;
}

export type FlowDecisionFieldType = 'STRING' | 'BOOLEAN' | 'SINGLE_SELECT';
export type FlowDecisionStringOperator = 'equals' | 'notEquals';

export interface FlowDecisionRoute {
  /** Stable outcome key used as the React Flow handle id and persisted result. */
  key: string;
  label: string;
  /** Present for SINGLE_SELECT option routes; absent for Otherwise. */
  value?: string;
  /** One immediate step or group. Several outcomes may share a target. */
  targetId: string;
}

/** Ticketless router evaluated from its single, form-gated parent step. */
export interface FlowPlanDecision {
  id: string;
  parentNodeId: string;
  fieldId: string;
  fieldName: string;
  fieldType: FlowDecisionFieldType;
  operator?: FlowDecisionStringOperator;
  comparisonValue?: string;
  routes: FlowDecisionRoute[];
}

/** Immutable result recorded when a run evaluates a decision. */
export interface FlowDecisionOutcome {
  outcomeKey: string;
  evaluatedAt: number;
  /**
   * The destination selected at evaluation time. Optional only for outcomes
   * written before decision destinations were pinned.
   */
  targetId?: string | null;
}

export type FlowDecisionResolution = Pick<FlowDecisionOutcome, 'outcomeKey' | 'targetId'>;

export interface FlowPlan {
  version: 2;
  nodes: FlowPlanNode[];
  groups?: FlowPlanGroup[];
  decisions?: FlowPlanDecision[];
  updatedAt: number;
}

/** Fixed, persisted lifecycle used by every FLOW-board ticket. */
export const FLOW_STAGE_NAMES = {
  TODO: 'TODO',
  STARTED: 'STARTED',
  PAUSED: 'PAUSED',
  BACKLOG: 'BACKLOG',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type FlowStageName = (typeof FLOW_STAGE_NAMES)[keyof typeof FLOW_STAGE_NAMES];

export const FLOW_STAGE_TRANSITIONS: ReadonlyArray<readonly [FlowStageName, FlowStageName]> = [
  [FLOW_STAGE_NAMES.TODO, FLOW_STAGE_NAMES.STARTED],
  [FLOW_STAGE_NAMES.STARTED, FLOW_STAGE_NAMES.PAUSED],
  [FLOW_STAGE_NAMES.STARTED, FLOW_STAGE_NAMES.BACKLOG],
  [FLOW_STAGE_NAMES.STARTED, FLOW_STAGE_NAMES.COMPLETED],
  [FLOW_STAGE_NAMES.STARTED, FLOW_STAGE_NAMES.CANCELLED],
  [FLOW_STAGE_NAMES.PAUSED, FLOW_STAGE_NAMES.STARTED],
  [FLOW_STAGE_NAMES.PAUSED, FLOW_STAGE_NAMES.BACKLOG],
  [FLOW_STAGE_NAMES.PAUSED, FLOW_STAGE_NAMES.COMPLETED],
  [FLOW_STAGE_NAMES.PAUSED, FLOW_STAGE_NAMES.CANCELLED],
  [FLOW_STAGE_NAMES.BACKLOG, FLOW_STAGE_NAMES.COMPLETED],
  [FLOW_STAGE_NAMES.BACKLOG, FLOW_STAGE_NAMES.CANCELLED],
];

/** Immutable design data copied onto a step ticket when that run node materializes. */
export interface FlowRunNodeSnapshot {
  planNodeId: string;
  title: string;
  description?: string;
  assignedTo?: string | null;
  gate: FlowStepGate;
  groupId?: string | null;
  groupName?: string | null;
  groupParentGroupId?: string | null;
  groupParentGroupName?: string | null;
  groupParentGroupParentPlanNodeIds?: string[];
  parentPlanNodeIds: string[];
  order: number;
  groupParentPlanNodeIds?: string[];
}

/** Derived runtime status of a group (groups have no ticket of their own). */
export type FlowGroupStatus = 'STARTED' | 'COMPLETED' | 'CANCELLED' | 'SKIPPED' | null;

export interface FlowReadinessResult {
  decisionSkippedNodeIds: Set<string>;
  deadNodeIds: Set<string>;
  completedGroupIds: Set<string>;
  readyNodeIds: Set<string>;
}

export interface FlowReadinessOptions {
  rootActive?: boolean;
  rootCancelled?: boolean;
}

export const FlowStepGateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirmation'), prompt: z.string().optional() }),
  z.object({ type: z.literal('form'), formId: z.string().min(1) }),
]);

export const FlowPlanGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  // Absent in plans saved before groups joined the DAG — defaulted on parse;
  // normalizeFlowPlan additionally migrates members' external parents here.
  parentIds: z.array(z.string()).default([]),
  order: z.number().optional(),
  groupId: z.string().nullable().optional(),
});

export const FlowPlanNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
  parentIds: z.array(z.string()),
  order: z.number(),
  gate: FlowStepGateSchema.optional(),
  groupId: z.string().nullable().optional(),
});

export const FlowDecisionRouteSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().optional(),
  targetId: z.string().min(1),
});

export const FlowPlanDecisionSchema = z.object({
  id: z.string().min(1),
  parentNodeId: z.string().min(1),
  fieldId: z.string().min(1),
  fieldName: z.string().min(1),
  fieldType: z.enum(['STRING', 'BOOLEAN', 'SINGLE_SELECT']),
  operator: z.enum(['equals', 'notEquals']).optional(),
  comparisonValue: z.string().optional(),
  routes: z.array(FlowDecisionRouteSchema),
});

export const FlowPlanSchema = z.object({
  version: z.literal(2),
  nodes: z.array(FlowPlanNodeSchema),
  groups: z.array(FlowPlanGroupSchema).optional(),
  decisions: z.array(FlowPlanDecisionSchema).optional(),
  updatedAt: z.number(),
});

const LegacyFlowPlanSchema = z.object({
  version: z.literal(1),
  nodes: z.array(FlowPlanNodeSchema),
  groups: z.array(FlowPlanGroupSchema).optional(),
  updatedAt: z.number(),
});

export function serializeFlowPlan(plan: FlowPlan): string {
  validateFlowPlan(plan);
  return JSON.stringify(plan);
}

export function deserializeFlowPlan(raw: string): FlowPlan {
  const parsed = z.union([FlowPlanSchema, LegacyFlowPlanSchema]).parse(JSON.parse(raw));
  const normalized = normalizeFlowPlan(parsed);
  validateFlowPlan(normalized);
  return normalized;
}

export function flowGateTypeOf(node: Pick<FlowPlanNode, 'gate'>): FlowStepGate['type'] {
  return node.gate?.type ?? 'confirmation';
}

export function flowGateOf(node: Pick<FlowPlanNode, 'gate'>): FlowStepGate {
  return node.gate ?? { type: 'confirmation' };
}

/**
 * Accepts plans saved by earlier shapes and returns the current one:
 * - single-parent `parentId` -> `parentIds`
 * - visual-only groups (members wired straight to outside steps) -> DAG
 *   groups: members' external parents move onto the group's `parentIds`,
 *   outside references to a member are remapped to the group id.
 * Safe (idempotent) to call on current plans.
 */
export function normalizeFlowPlan(plan: {
  version: 1 | 2;
  updatedAt: number;
  nodes: Array<
    Partial<FlowPlanNode> & {
      id: string;
      title: string;
      order: number;
      parentId?: string | null;
    }
  >;
  groups?: Array<Omit<FlowPlanGroup, 'parentIds'> & { parentIds?: string[] }>;
  decisions?: FlowPlanDecision[];
}): FlowPlan {
  const groupIds = new Set((plan.groups ?? []).map((group) => group.id));
  const groupScope = new Map(
    (plan.groups ?? []).map((group) => [group.id, group.groupId ?? null]),
  );
  const groupOfNode = new Map<string, string>();
  for (const node of plan.nodes) {
    if (node.groupId && groupIds.has(node.groupId)) groupOfNode.set(node.id, node.groupId);
  }
  const decisionScope = new Map(
    (plan.decisions ?? []).map((decision) => [
      decision.id,
      groupOfNode.get(decision.parentNodeId) ?? null,
    ]),
  );
  const scopeOf = (id: string): string | null =>
    groupOfNode.get(id) ?? groupScope.get(id) ?? decisionScope.get(id) ?? null;
  // A parent reference seen from OUTSIDE a group resolves to the group itself
  const externalRef = (id: string): string => groupOfNode.get(id) ?? id;

  const extraGroupParents = new Map<string, Set<string>>();
  const nodes: FlowPlanNode[] = plan.nodes.map((node) => {
    const rawParentIds = node.parentIds ?? (node.parentId ? [node.parentId] : []);
    const groupId = groupOfNode.get(node.id) ?? null;
    let parentIds: string[];
    if (groupId) {
      // Members keep only same-group parents; external ones become parents of
      // the group itself (legacy visual-group migration).
      parentIds = rawParentIds.filter((parentId) => scopeOf(parentId) === groupId);
      const external = rawParentIds
        .filter((parentId) => scopeOf(parentId) !== groupId)
        .map(externalRef)
        .filter((parentId) => parentId !== groupId);
      if (external.length > 0) {
        const set = extraGroupParents.get(groupId) ?? new Set<string>();
        for (const parentId of external) set.add(parentId);
        extraGroupParents.set(groupId, set);
      }
    } else {
      parentIds = [...new Set(rawParentIds.map(externalRef))];
    }
    return {
      id: node.id,
      title: node.title,
      order: node.order,
      ...(node.description !== undefined && { description: node.description }),
      ...(node.assignedTo !== undefined && { assignedTo: node.assignedTo }),
      // Drop retired gate shapes (e.g. the old 'passover') back to the default
      ...(node.gate !== undefined &&
        (node.gate.type === 'confirmation' || node.gate.type === 'form') && {
          gate: node.gate,
        }),
      ...(groupId && { groupId }),
      parentIds,
    };
  });

  const groups: FlowPlanGroup[] = (plan.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    parentIds: [
      ...new Set([...(group.parentIds ?? []), ...(extraGroupParents.get(group.id) ?? [])]),
    ].filter((parentId) => parentId !== group.id),
    ...(group.order !== undefined && { order: group.order }),
    ...(group.groupId && { groupId: group.groupId }),
  }));

  return {
    version: 2,
    updatedAt: plan.updatedAt,
    groups,
    nodes,
    decisions: plan.decisions ?? [],
  };
}

export function flowDecisionOutcomeKey(
  decision: FlowPlanDecision,
  rawValue: unknown
): string | null {
  if (decision.fieldType === 'BOOLEAN') {
    if (rawValue === true || rawValue === 'true') return 'yes';
    if (rawValue === false || rawValue === 'false') return 'no';
    return null;
  }
  if (decision.fieldType === 'SINGLE_SELECT') {
    const value = typeof rawValue === 'string' ? rawValue : '';
    return decision.routes.find((route) => route.value === value)?.key ?? 'otherwise';
  }
  const actual = typeof rawValue === 'string' ? rawValue.trim().toLocaleLowerCase() : '';
  const expected = (decision.comparisonValue ?? '').trim().toLocaleLowerCase();
  const equals = actual === expected;
  const matches = decision.operator === 'notEquals' ? !equals : equals;
  return matches ? 'match' : 'otherwise';
}

/**
 * Members of a group that no other member depends on — the group's exits.
 * The group counts as COMPLETED once all of these are completed.
 */
export function flowGroupTerminalIds(members: FlowPlanNode[]): string[] {
  const referenced = new Set(members.flatMap((member) => member.parentIds));
  return members.filter((member) => !referenced.has(member.id)).map((member) => member.id);
}

/**
 * Orders members by dependency level: entry members (no parents) first, then
 * their dependents level by level — the collapsed member list reads in flow
 * order. Generic so both plan nodes and lighter member rows can be sorted.
 */
export function flowGroupMembersInLevelOrder<T extends { id: string; parentIds: string[] }>(
  members: T[]
): T[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const levelById = new Map<string, number>();
  const levelOf = (member: T): number => {
    const cached = levelById.get(member.id);
    if (cached !== undefined) return cached;
    levelById.set(member.id, 0); // cycle guard — plans are validated acyclic
    const parents = member.parentIds
      .map((parentId) => byId.get(parentId))
      .filter((parent): parent is T => !!parent);
    const level = parents.length === 0 ? 0 : Math.max(...parents.map(levelOf)) + 1;
    levelById.set(member.id, level);
    return level;
  };
  const rows: T[][] = [];
  for (const member of members) {
    const level = levelOf(member);
    const row = rows[level] ?? [];
    rows[level] = row;
    row.push(member);
  }
  return rows.flat();
}

/**
 * Structural validation beyond the zod shape: ids unique, every parent
 * resolves, no duplicate/self parents, group connectivity rules hold
 * (members only wire within their group; outside steps and groups wire to
 * ungrouped steps or groups), and the combined step+group graph is a DAG.
 * Throws with a descriptive message.
 */
export function validateFlowPlan(plan: FlowPlan): void {
  const groupIds = new Set<string>();
  for (const group of plan.groups ?? []) {
    if (groupIds.has(group.id)) {
      throw new Error(`Flow plan has duplicate group id: ${group.id}`);
    }
    groupIds.add(group.id);
  }
  const groupById = new Map((plan.groups ?? []).map((group) => [group.id, group]));
  for (const group of plan.groups ?? []) {
    if (!group.groupId) continue;
    const parentGroup = groupById.get(group.groupId);
    if (!parentGroup) {
      throw new Error(
        `The group “${group.name || 'Untitled group'}” is inside a group that no longer exists`
      );
    }
    if (parentGroup.groupId) {
      throw new Error('Flow groups can only be nested one level deep');
    }
    if (parentGroup.id === group.id) {
      throw new Error(`The group “${group.name || 'Untitled group'}” cannot contain itself`);
    }
  }
  const nodeById = new Map<string, FlowPlanNode>();
  for (const node of plan.nodes) {
    if (nodeById.has(node.id) || groupIds.has(node.id)) {
      throw new Error(`Flow plan has duplicate id: ${node.id}`);
    }
    nodeById.set(node.id, node);
    if (node.groupId && !groupIds.has(node.groupId)) {
      throw new Error(`Flow plan node ${node.id} references missing group ${node.groupId}`);
    }
  }
  const decisionById = new Map<string, FlowPlanDecision>();
  for (const decision of plan.decisions ?? []) {
    if (decisionById.has(decision.id) || nodeById.has(decision.id) || groupIds.has(decision.id)) {
      throw new Error(`Flow plan has duplicate id: ${decision.id}`);
    }
    decisionById.set(decision.id, decision);
  }

  // External graph vertices are ungrouped steps and groups; members are
  // internal to their group.
  const checkParentList = (ownerLabel: string, parentIds: string[]): void => {
    const seen = new Set<string>();
    for (const parentId of parentIds) {
      if (seen.has(parentId)) {
        throw new Error(`${ownerLabel} lists parent ${parentId} twice`);
      }
      seen.add(parentId);
    }
  };

  for (const node of plan.nodes) {
    checkParentList(`Flow plan node ${node.id}`, node.parentIds);
    for (const parentId of node.parentIds) {
      if (parentId === node.id) {
        throw new Error(`Flow plan node ${node.id} is its own parent`);
      }
      if (node.groupId) {
        const parent = nodeById.get(parentId);
        const parentGroup = groupById.get(parentId);
        const parentDecision = decisionById.get(parentId);
        const decisionSource = parentDecision
          ? nodeById.get(parentDecision.parentNodeId)
          : undefined;
        if (
          (!parent || parent.groupId !== node.groupId) &&
          (!parentGroup || parentGroup.groupId !== node.groupId) &&
          (!parentDecision || decisionSource?.groupId !== node.groupId)
        ) {
          throw new Error(
            `Grouped step ${node.id} may only have parents inside its group (got ${parentId})`
          );
        }
      } else {
        const parent = nodeById.get(parentId);
        const parentGroup = groupById.get(parentId);
        if (parent?.groupId) {
          throw new Error(
            `Step ${node.id} references grouped step ${parentId} — connect the group instead`
          );
        }
        if (parentGroup?.groupId) {
          throw new Error(
            `Step ${node.id} references nested group ${parentId} — connect its outer group instead`
          );
        }
        if (!parent && !groupIds.has(parentId) && !decisionById.has(parentId)) {
          throw new Error(`Flow plan node ${node.id} references missing parent ${parentId}`);
        }
      }
    }
  }
  for (const group of plan.groups ?? []) {
    checkParentList(`Flow plan group ${group.id}`, group.parentIds);
    for (const parentId of group.parentIds) {
      if (parentId === group.id) {
        throw new Error(`Flow plan group ${group.id} is its own parent`);
      }
      const parent = nodeById.get(parentId);
      const parentGroup = groupById.get(parentId);
      const parentDecision = decisionById.get(parentId);
      const decisionSource = parentDecision
        ? nodeById.get(parentDecision.parentNodeId)
        : undefined;
      const scopeId = group.groupId ?? null;
      const parentScopeId = parent
        ? (parent.groupId ?? null)
        : parentGroup
          ? (parentGroup.groupId ?? null)
          : parentDecision
            ? (decisionSource?.groupId ?? null)
            : null;
      if ((parent || parentGroup || parentDecision) && parentScopeId !== scopeId) {
        throw new Error(
          group.groupId
            ? `The nested group “${group.name || 'Untitled group'}” may only connect to items inside its outer group`
            : `The group “${group.name || 'Untitled group'}” cannot connect directly to an item inside another group`
        );
      }
      if (!parent && !groupIds.has(parentId) && !decisionById.has(parentId)) {
        throw new Error(`Flow plan group ${group.id} references missing parent ${parentId}`);
      }
    }
  }

  const decisionsByParent = new Map<string, FlowPlanDecision>();
  for (const decision of plan.decisions ?? []) {
    const source = nodeById.get(decision.parentNodeId);
    if (!source || flowGateTypeOf(source) !== 'form') {
      throw new Error('A decision must be connected directly after a form step');
    }
    if (decisionsByParent.has(source.id)) {
      throw new Error(`The form step “${source.title}” can only have one decision`);
    }
    decisionsByParent.set(source.id, decision);
    const ordinaryChild = plan.nodes.some((node) => node.parentIds.includes(source.id));
    const ordinaryGroupChild = (plan.groups ?? []).some((group) =>
      group.parentIds.includes(source.id)
    );
    if (ordinaryChild || ordinaryGroupChild) {
      throw new Error(
        `The form step “${source.title}” cannot have both a decision and a direct next step`
      );
    }

    if (!decision.fieldId || !decision.fieldName) {
      throw new Error('Choose the required form field this decision should use');
    }

    const routeKeys = new Set<string>();
    for (const route of decision.routes) {
      if (routeKeys.has(route.key)) {
        throw new Error(`The “${decision.fieldName || 'Decision'}” decision has a duplicate path`);
      }
      routeKeys.add(route.key);
      if (!route.targetId) {
        throw new Error(`Choose where the “${route.label}” decision path should go`);
      }
      const targetNode = nodeById.get(route.targetId);
      const targetGroup = groupById.get(route.targetId);
      if (!targetNode && !targetGroup) {
        throw new Error(
          `The “${route.label}” path from “${decision.fieldName || 'Decision'}” points to a deleted step`
        );
      }
      if (source.groupId) {
        const targetScopeId = targetNode?.groupId ?? targetGroup?.groupId ?? null;
        if ((!targetNode && !targetGroup) || targetScopeId !== source.groupId) {
          throw new Error(
            `The “${decision.fieldName || 'Decision'}” decision must stay inside its current group`
          );
        }
      } else if (targetNode?.groupId || targetGroup?.groupId) {
        throw new Error(
          `The “${route.label}” path cannot point directly to a step inside a group; choose the group instead`
        );
      }
      const targetParents = targetNode?.parentIds ?? targetGroup?.parentIds ?? [];
      if (targetParents.length !== 1 || targetParents[0] !== decision.id) {
        const targetName = targetNode?.title || targetGroup?.name || 'Decision destination';
        throw new Error(
          `“${targetName}” has another incoming connection. A decision destination can only start from its decision path`
        );
      }
    }

    if (decision.fieldType === 'STRING') {
      if (!decision.comparisonValue?.trim() || !decision.operator) {
        throw new Error(
          `Enter the value that the “${decision.fieldName || 'Decision'}” decision should compare against`
        );
      }
      if (routeKeys.size !== 2 || !routeKeys.has('match') || !routeKeys.has('otherwise')) {
        throw new Error('A text decision needs both Match and Otherwise paths');
      }
    } else if (decision.fieldType === 'BOOLEAN') {
      if (routeKeys.size !== 2 || !routeKeys.has('yes') || !routeKeys.has('no')) {
        throw new Error('A Yes/No decision needs both Yes and No paths');
      }
    } else {
      const optionRoutes = decision.routes.filter((route) => route.key !== 'otherwise');
      if (!routeKeys.has('otherwise') || optionRoutes.length === 0) {
        throw new Error('A single-select decision needs its option paths and an Otherwise path');
      }
      if (optionRoutes.some((route) => route.value === undefined)) {
        throw new Error('One of the single-select decision paths has no option value');
      }
    }
  }

  for (const node of plan.nodes) {
    for (const parentId of node.parentIds) {
      const decision = decisionById.get(parentId);
      if (decision && !decision.routes.some((route) => route.targetId === node.id)) {
        throw new Error(
          `“${node.title || 'Untitled step'}” is still linked to the “${decision.fieldName || 'Decision'}” decision, but no decision path points to it. Reconnect the step or choose it as a destination`
        );
      }
    }
  }
  for (const group of plan.groups ?? []) {
    for (const parentId of group.parentIds) {
      const decision = decisionById.get(parentId);
      if (decision && !decision.routes.some((route) => route.targetId === group.id)) {
        throw new Error(
          `The group “${group.name || 'Untitled group'}” is still linked to the “${decision.fieldName || 'Decision'}” decision, but no decision path points to it. Reconnect the group or choose it as a destination`
        );
      }
    }
  }

  // Cycle detection via iterative DFS over the combined parent links:
  // member -> internal parents + its group (it starts after the group),
  // ungrouped step -> steps/groups, group -> its parents.
  const parentsOf = (id: string): string[] => {
    const node = nodeById.get(id);
    if (node) {
      return node.groupId ? [...node.parentIds, node.groupId] : node.parentIds;
    }
    const group = (plan.groups ?? []).find((candidate) => candidate.id === id);
    if (group) return group.groupId ? [...group.parentIds, group.groupId] : group.parentIds;
    const decision = decisionById.get(id);
    return decision ? [decision.parentNodeId] : [];
  };
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (startId: string): void => {
    const stack: Array<{ id: string; parents: string[]; parentIndex: number }> = [
      { id: startId, parents: parentsOf(startId), parentIndex: 0 },
    ];
    state.set(startId, 'visiting');
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      if (frame.parentIndex >= frame.parents.length) {
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }
      const parentId = frame.parents[frame.parentIndex];
      frame.parentIndex += 1;
      if (parentId === undefined) continue;
      const parentState = state.get(parentId);
      if (parentState === 'visiting') {
        throw new Error(`Flow plan contains a cycle involving ${parentId}`);
      }
      if (parentState === undefined) {
        state.set(parentId, 'visiting');
        stack.push({
          id: parentId,
          parents: parentsOf(parentId),
          parentIndex: 0,
        });
      }
    }
  };
  const allIds = [...plan.nodes.map((node) => node.id), ...groupIds, ...decisionById.keys()];
  for (const id of allIds) {
    if (!state.has(id)) visit(id);
  }
}

/** Indexed read model over a normalized FLOW plan. */
export class FlowPlanModel {
  readonly plan: FlowPlan;
  readonly nodes: FlowPlanNode[];
  readonly groups: FlowPlanGroup[];
  readonly decisions: FlowPlanDecision[];

  private readonly nodeIndex: Map<string, FlowPlanNode>;
  private readonly groupIndex: Map<string, FlowPlanGroup>;
  private readonly decisionIndex: Map<string, FlowPlanDecision>;
  private readonly membersIndex: Map<string, FlowPlanNode[]>;
  private readonly childGroupsIndex: Map<string, FlowPlanGroup[]>;
  private terminalsCache: Map<string, string[]> | null = null;

  constructor(plan: FlowPlan) {
    this.plan = plan;
    this.nodes = plan.nodes;
    this.groups = plan.groups ?? [];
    this.decisions = plan.decisions ?? [];
    this.nodeIndex = new Map(this.nodes.map((node) => [node.id, node]));
    this.groupIndex = new Map(this.groups.map((group) => [group.id, group]));
    this.decisionIndex = new Map(this.decisions.map((decision) => [decision.id, decision]));
    this.membersIndex = new Map();
    this.childGroupsIndex = new Map();
    for (const node of this.nodes) {
      if (!node.groupId || !this.groupIndex.has(node.groupId)) continue;
      const list = this.membersIndex.get(node.groupId) ?? [];
      list.push(node);
      this.membersIndex.set(node.groupId, list);
    }
    for (const group of this.groups) {
      if (!group.groupId || !this.groupIndex.has(group.groupId)) continue;
      const list = this.childGroupsIndex.get(group.groupId) ?? [];
      list.push(group);
      this.childGroupsIndex.set(group.groupId, list);
    }
  }

  static parse(raw: Parameters<typeof normalizeFlowPlan>[0]): FlowPlanModel {
    return new FlowPlanModel(normalizeFlowPlan(raw));
  }

  static parseAndValidate(raw: Parameters<typeof normalizeFlowPlan>[0]): FlowPlanModel {
    const plan = normalizeFlowPlan(raw);
    validateFlowPlan(plan);
    return new FlowPlanModel(plan);
  }

  getNode(id: string): FlowPlanNode | undefined {
    return this.nodeIndex.get(id);
  }

  getGroup(id: string): FlowPlanGroup | undefined {
    return this.groupIndex.get(id);
  }

  /** The group itself followed by each containing group, nearest first. */
  groupAndAncestorIds(groupId: string): string[] {
    const ids: string[] = [];
    let group = this.getGroup(groupId);
    while (group) {
      ids.push(group.id);
      group = group.groupId ? this.getGroup(group.groupId) : undefined;
    }
    return ids;
  }

  getDecision(id: string): FlowPlanDecision | undefined {
    return this.decisionIndex.get(id);
  }

  decisionAfter(nodeId: string): FlowPlanDecision | undefined {
    return this.decisions.find((decision) => decision.parentNodeId === nodeId);
  }

  isGroup(id: string): boolean {
    return this.groupIndex.has(id);
  }

  isDecision(id: string): boolean {
    return this.decisionIndex.has(id);
  }

  get isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  membersOf(groupId: string): FlowPlanNode[] {
    return this.membersIndex.get(groupId) ?? [];
  }

  childGroupsOf(groupId: string): FlowPlanGroup[] {
    return this.childGroupsIndex.get(groupId) ?? [];
  }

  descendantMembersOf(groupId: string): FlowPlanNode[] {
    return [
      ...this.membersOf(groupId),
      ...this.childGroupsOf(groupId).flatMap((group) => this.membersOf(group.id)),
    ];
  }

  isMember(node: Pick<FlowPlanNode, 'groupId'>): boolean {
    return !!node.groupId && this.groupIndex.has(node.groupId);
  }

  get activeGroups(): FlowPlanGroup[] {
    return this.groups.filter(
      (group) =>
        this.membersOf(group.id).length > 0 ||
        this.childGroupsOf(group.id).some((child) => this.membersOf(child.id).length > 0)
    );
  }

  get activeGroupIds(): Set<string> {
    return new Set(this.activeGroups.map((group) => group.id));
  }

  isActiveGroup(id: string): boolean {
    return this.activeGroupIds.has(id);
  }

  parentIdsOf(id: string): string[] {
    return (
      this.nodeIndex.get(id)?.parentIds ??
      this.groupIndex.get(id)?.parentIds ??
      (this.decisionIndex.has(id) ? [this.decisionIndex.get(id)!.parentNodeId] : [])
    );
  }

  routeForOutcome(decisionId: string, outcomeKey: string): FlowDecisionRoute | undefined {
    return this.decisionIndex.get(decisionId)?.routes.find((route) => route.key === outcomeKey);
  }

  /** Resolve a run decision through its pinned destination when available. */
  resolvedDecisionTargetId(
    decisionId: string,
    resolution: FlowDecisionResolution
  ): string | undefined {
    return resolution.targetId !== undefined
      ? (resolution.targetId ?? undefined)
      : this.routeForOutcome(decisionId, resolution.outcomeKey)?.targetId;
  }

  /** Return a run read model whose evaluated routes point at their immutable destinations. */
  withResolvedDecisionTargets(
    resolutionByDecisionId: ReadonlyMap<string, FlowDecisionResolution>
  ): FlowPlanModel {
    let changed = false;
    const decisions = this.decisions.map((decision) => {
      const resolution = resolutionByDecisionId.get(decision.id);
      const targetId = resolution
        ? this.resolvedDecisionTargetId(decision.id, resolution)
        : undefined;
      if (!resolution || !targetId) return decision;
      let decisionChanged = false;
      const routes = decision.routes.map((route) => {
        if (route.key !== resolution.outcomeKey || route.targetId === targetId) return route;
        decisionChanged = true;
        changed = true;
        return { ...route, targetId };
      });
      return decisionChanged ? { ...decision, routes } : decision;
    });
    return changed ? new FlowPlanModel({ ...this.plan, decisions }) : this;
  }

  targetIdsOfDecision(decisionId: string): string[] {
    return [
      ...new Set(this.decisionIndex.get(decisionId)?.routes.map((route) => route.targetId) ?? []),
    ];
  }

  /**
   * A grouped entry step (no internal parents) effectively depends on the
   * GROUP's parents; every other node just uses its own parents.
   */
  effectiveGroupParentIds(groupId: string): string[] {
    const group = this.getGroup(groupId);
    if (!group) return [];
    if (group.parentIds.length > 0) return group.parentIds;
    return group.groupId ? this.effectiveGroupParentIds(group.groupId) : [];
  }

  effectiveParentIds(node: FlowPlanNode): string[] {
    const group = node.groupId ? this.getGroup(node.groupId) : undefined;
    if (group && node.parentIds.length === 0) return this.effectiveGroupParentIds(group.id);
    return node.parentIds;
  }

  /** Entity selected by a decision for this node's effective entry edge. */
  effectiveEntryEntityId(node: FlowPlanNode): string {
    if (!this.isEntryMember(node) || !node.groupId) return node.id;
    let group = this.getGroup(node.groupId);
    while (group?.groupId && group.parentIds.length === 0) {
      group = this.getGroup(group.groupId);
    }
    return group?.id ?? node.id;
  }

  /** Terminal ("exit") members of a group — no other member depends on them. */
  terminalEntityIdsOf(groupId: string): string[] {
    const members = this.membersOf(groupId);
    const childGroups = this.childGroupsOf(groupId);
    const referenced = new Set([
      ...members.flatMap((member) => member.parentIds),
      ...childGroups.flatMap((group) => group.parentIds),
    ]);
    for (const decision of this.decisions) {
      if (members.some((member) => member.id === decision.parentNodeId)) {
        referenced.add(decision.parentNodeId);
      }
    }
    return [
      ...members.filter((member) => !referenced.has(member.id)).map((member) => member.id),
      ...childGroups.filter((group) => !referenced.has(group.id)).map((group) => group.id),
    ];
  }

  /** Leaf ticket ids reached by the group's terminal direct entities. */
  terminalIdsOf(groupId: string): string[] {
    if (!this.terminalsCache) this.terminalsCache = new Map();
    const cached = this.terminalsCache.get(groupId);
    if (cached) return cached;
    const terminals = this.terminalEntityIdsOf(groupId).flatMap((id) =>
      this.isGroup(id) ? this.terminalIdsOf(id) : [id]
    );
    this.terminalsCache.set(groupId, terminals);
    return terminals;
  }

  isEntryMember(node: FlowPlanNode): boolean {
    return this.isMember(node) && node.parentIds.length === 0;
  }

  isTerminalMember(node: FlowPlanNode): boolean {
    return this.isMember(node) && this.terminalIdsOf(node.groupId ?? '').includes(node.id);
  }

  membersInLevelOrder(groupId: string): FlowPlanNode[] {
    const members = [...this.membersOf(groupId)].sort((a, b) => a.order - b.order);
    return flowGroupMembersInLevelOrder(members);
  }

  /** Direct steps and child groups in dependency order for collapsed covers. */
  directEntityIdsInLevelOrder(groupId: string): string[] {
    const resolveDecisionParent = (parentId: string): string =>
      this.getDecision(parentId)?.parentNodeId ?? parentId;
    const items = [
      ...this.membersOf(groupId).map((member) => ({
        id: member.id,
        parentIds: member.parentIds.map(resolveDecisionParent),
        order: this.layoutOrder(member.id),
      })),
      ...this.childGroupsOf(groupId).map((group) => ({
        id: group.id,
        parentIds: group.parentIds.map(resolveDecisionParent),
        order: this.layoutOrder(group.id),
      })),
    ].sort((left, right) => left.order - right.order);
    return flowGroupMembersInLevelOrder(items).map((item) => item.id);
  }

  groupOrder(groupId: string): number {
    const explicitOrder = this.getGroup(groupId)?.order;
    if (explicitOrder !== undefined) return explicitOrder;
    const members = this.descendantMembersOf(groupId);
    return members.length > 0 ? Math.min(...members.map((member) => member.order)) : 0;
  }

  /**
   * Stable visual order with a decision's route order as the tie-breaker.
   * Existing plans often gave both branch groups the same derived order,
   * which placed their targets opposite the decision handles and crossed the
   * paths after auto-layout.
   */
  layoutOrder(entityId: string): number {
    const entity = this.getNode(entityId) ?? this.getGroup(entityId);
    if (!entity) return 0;
    const baseOrder = this.getNode(entityId)?.order ?? this.groupOrder(entityId);
    const decisionParent = entity.parentIds
      .map((parentId) => this.getDecision(parentId))
      .find((decision): decision is FlowPlanDecision => !!decision);
    const routeIndex = decisionParent
      ? Math.max(
          0,
          decisionParent.routes.findIndex((route) => route.targetId === entityId),
        )
      : 0;
    return baseOrder * 1000 + routeIndex;
  }

  /**
   * Compares ticket traversal breadth-first across visible graph rows, then
   * from the outermost visible entity inward. A deeper branch in the first
   * column therefore cannot jump ahead of unopened columns on the current row.
   */
  compareTraversalOrder(leftId: string, rightId: string): number {
    const topLevelEntityId = (entityId: string): string => {
      const node = this.getNode(entityId);
      const groupId = node?.groupId ?? this.getGroup(entityId)?.groupId;
      if (!groupId) return entityId;
      const ancestors = this.groupAndAncestorIds(groupId);
      return ancestors[ancestors.length - 1] ?? entityId;
    };
    const levelById = new Map<string, number>();
    const levelOf = (entityId: string): number => {
      const topLevelId = topLevelEntityId(entityId);
      const cached = levelById.get(topLevelId);
      if (cached !== undefined) return cached;
      levelById.set(topLevelId, 0); // cycle guard — validated plans are acyclic
      const parents = this.parentIdsOf(topLevelId).map(
        (parentId) => this.getDecision(parentId)?.parentNodeId ?? parentId
      );
      const level = parents.length === 0 ? 0 : Math.max(...parents.map(levelOf)) + 1;
      levelById.set(topLevelId, level);
      return level;
    };
    const pathOf = (entityId: string): number[] => {
      const node = this.getNode(entityId);
      const groupPath = node?.groupId
        ? this.groupAndAncestorIds(node.groupId)
            .reverse()
            .map((groupId) => this.layoutOrder(groupId))
        : [];
      return [levelOf(entityId), ...groupPath, this.layoutOrder(entityId)];
    };
    const leftPath = pathOf(leftId);
    const rightPath = pathOf(rightId);
    const length = Math.max(leftPath.length, rightPath.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftPath[index] ?? -1) - (rightPath[index] ?? -1);
      if (difference !== 0) return difference;
    }
    return (
      this.nodes.findIndex((node) => node.id === leftId) -
      this.nodes.findIndex((node) => node.id === rightId)
    );
  }

  /**
   * Derived runtime status of a group (groups have no ticket of their own):
   * - any member CANCELLED            -> 'CANCELLED'
   * - every member skipped            -> 'SKIPPED'
   * - every terminal member COMPLETED -> 'COMPLETED'
   * - any member instantiated         -> 'STARTED'
   * - otherwise                       -> null (yet to start)
   */
  deriveGroupStatus(
    groupId: string,
    statusByNodeId: ReadonlyMap<string, string>,
    skippedNodeIds: ReadonlySet<string> = new Set()
  ): FlowGroupStatus {
    const members = this.descendantMembersOf(groupId);
    if (members.length === 0) return null;
    const statuses = members.map((member) => statusByNodeId.get(member.id));
    if (statuses.some((status) => status === 'CANCELLED')) return 'CANCELLED';
    if (members.every((member) => skippedNodeIds.has(member.id))) return 'SKIPPED';
    const terminals = this.terminalIdsOf(groupId);
    if (
      terminals.length > 0 &&
      terminals.every((id) => statusByNodeId.get(id) === 'COMPLETED' || skippedNodeIds.has(id))
    ) {
      return 'COMPLETED';
    }
    if (statuses.some((status) => status !== undefined)) return 'STARTED';
    return null;
  }

  evaluateReadiness(
    statusByNodeId: ReadonlyMap<string, string>,
    decisionOutcomeById: ReadonlyMap<string, FlowDecisionResolution> = new Map(),
    options: FlowReadinessOptions = {}
  ): FlowReadinessResult {
    const decisionSkipped = new Set<string>();
    const notInstantiated = (node: FlowPlanNode): boolean => !statusByNodeId.has(node.id);
    const satisfied = (nodeId: string): boolean => {
      const status = statusByNodeId.get(nodeId);
      return status === 'COMPLETED' || status === 'BACKLOG';
    };
    const cancelled = (nodeId: string): boolean => statusByNodeId.get(nodeId) === 'CANCELLED';
    const groupCancelled = (groupId: string): boolean =>
      this.descendantMembersOf(groupId).some((member) => cancelled(member.id));
    const entityDecisionSkipped = (entityId: string): boolean => {
      if (!this.isGroup(entityId)) return decisionSkipped.has(entityId);
      const terminals = this.terminalIdsOf(entityId);
      return terminals.length > 0 && terminals.every((id) => decisionSkipped.has(id));
    };

    // A direct decision mismatch kills its branch entry. Descendants die only
    // when every non-decision incoming route is already decision-skipped.
    // Thus one skipped alternative cannot poison a convergence node.
    let decisionChanged = true;
    while (decisionChanged) {
      decisionChanged = false;
      for (const node of this.nodes) {
        if (!notInstantiated(node) || decisionSkipped.has(node.id)) continue;
        const parents = this.effectiveParentIds(node);
        const targetEntityId = this.effectiveEntryEntityId(node);
        const mismatched = parents.some((parentId) => {
          const outcome = decisionOutcomeById.get(parentId);
          return (
            this.isDecision(parentId) &&
            !!outcome &&
            this.resolvedDecisionTargetId(parentId, outcome) !== targetEntityId
          );
        });
        const routeParents = parents.filter((parentId) => !this.isDecision(parentId));
        const noViableParentRoute =
          routeParents.length > 0 && routeParents.every(entityDecisionSkipped);
        if (mismatched || noViableParentRoute) {
          decisionSkipped.add(node.id);
          decisionChanged = true;
        }
      }
    }

    const completedGroupIds = new Set(
      this.activeGroups
        .filter((group) => {
          if (groupCancelled(group.id)) return false;
          const terminals = this.terminalIdsOf(group.id);
          return (
            terminals.length > 0 &&
            terminals.every((id) => satisfied(id) || decisionSkipped.has(id))
          );
        })
        .map((group) => group.id)
    );

    const dead = new Set<string>(decisionSkipped);
    if (options.rootCancelled) {
      for (const node of this.nodes) {
        if (notInstantiated(node)) dead.add(node.id);
      }
    } else {
      const groupBlocked = (groupId: string): boolean => {
        if (groupCancelled(groupId)) return true;
        return this.terminalIdsOf(groupId).some(
          (id) => !decisionSkipped.has(id) && (cancelled(id) || dead.has(id))
        );
      };
      const parentBlocked = (parentId: string): boolean => {
        if (entityDecisionSkipped(parentId)) return false;
        return this.isGroup(parentId)
          ? groupBlocked(parentId)
          : cancelled(parentId) || dead.has(parentId);
      };

      let changed = true;
      while (changed) {
        changed = false;
        for (const node of this.nodes) {
          if (dead.has(node.id) || !notInstantiated(node)) continue;
          const inCancelledGroup = this.isMember(node) && groupCancelled(node.groupId ?? '');
          const targetEntityId = this.effectiveEntryEntityId(node);
          const blockedByDecision = this.effectiveParentIds(node).some((parentId) => {
            const outcome = decisionOutcomeById.get(parentId);
            return (
              this.isDecision(parentId) &&
              !!outcome &&
              this.resolvedDecisionTargetId(parentId, outcome) !== targetEntityId
            );
          });
          const blockedByParent = this.effectiveParentIds(node)
            .filter((parentId) => !this.isDecision(parentId))
            .some(parentBlocked);
          if (inCancelledGroup || blockedByDecision || blockedByParent) {
            dead.add(node.id);
            changed = true;
          }
        }
      }
    }

    const parentSatisfied = (parentId: string, targetEntityId: string): boolean => {
      if (this.isDecision(parentId)) {
        const outcome = decisionOutcomeById.get(parentId);
        return !!outcome && this.resolvedDecisionTargetId(parentId, outcome) === targetEntityId;
      }
      if (entityDecisionSkipped(parentId)) return true;
      return this.isGroup(parentId) ? completedGroupIds.has(parentId) : satisfied(parentId);
    };
    const readyNodeIds = new Set(
      this.nodes
        .filter((node) => {
          if (!notInstantiated(node) || dead.has(node.id)) return false;
          if (
            this.isMember(node) &&
            this.groupAndAncestorIds(node.groupId ?? '').some(groupCancelled)
          ) {
            return false;
          }
          const parents = this.effectiveParentIds(node);
          if (parents.length === 0) return options.rootActive === true;
          const targetEntityId = this.effectiveEntryEntityId(node);
          return parents.every((parentId) => parentSatisfied(parentId, targetEntityId));
        })
        .map((node) => node.id)
    );

    return {
      decisionSkippedNodeIds: decisionSkipped,
      deadNodeIds: dead,
      completedGroupIds,
      readyNodeIds,
    };
  }

  /**
   * Plan-node ids that can never run — the run is cancelled, or an (effective)
   * parent is permanently blocked. Group-aware; rendered as "Skipped" ghosts.
   *
   * @param statusByNodeId per-run status of instantiated steps (absent = ghost)
   * @param rootCancelled  the run's main ticket itself is cancelled
   */
  skippedPlanNodeIds(
    statusByNodeId: ReadonlyMap<string, string>,
    rootCancelled: boolean,
    decisionOutcomeById: ReadonlyMap<string, FlowDecisionResolution> = new Map()
  ): Set<string> {
    return this.evaluateReadiness(statusByNodeId, decisionOutcomeById, {
      rootCancelled,
    }).deadNodeIds;
  }
}
