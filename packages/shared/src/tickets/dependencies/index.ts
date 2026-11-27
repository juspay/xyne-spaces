import type {
  BoardDependencyPolicy,
  DependencyBoard,
  DependencyContext,
  DependencyDate,
  DependencyEdge,
  DependencyGatingColumns,
  DependencyReferenceRow,
  DependencyStage,
  DependencyState,
  DependencyStrength,
  DependencySubTicketMapping,
  DependencyTicket,
} from './types.js';

export type * from './types.js';

const DAY_MS = 86_400_000;

/** Do not share a mutable array/object across callers or boards. */
export function dependencyPolicy(metadata: unknown): BoardDependencyPolicy {
  const policy =
    metadata && typeof metadata === 'object' && 'dependencyPolicy' in metadata
      ? metadata.dependencyPolicy
      : null;
  const value = policy && typeof policy === 'object' ? policy : {};
  return {
    defaultStrength:
      'defaultStrength' in value && value.defaultStrength === 'HARD' ? 'HARD' : 'SOFT',
    hardGateStageIds:
      'hardGateStageIds' in value && Array.isArray(value.hardGateStageIds)
        ? value.hardGateStageIds.filter((id): id is string => typeof id === 'string')
        : [],
    automationOnSoftGate:
      'automationOnSoftGate' in value && value.automationOnSoftGate === 'STOP' ? 'STOP' : 'PROCEED',
  };
}

function gating(
  row: DependencyGatingColumns,
): Pick<DependencyEdge, 'strength' | 'gatedStageId' | 'satisfiedAt' | 'override'> {
  return {
    strength: row.strength === 'HARD' ? 'HARD' : 'SOFT',
    gatedStageId: row.gatedStageId ?? null,
    satisfiedAt: row.satisfiedAt ?? null,
    override:
      row.overriddenAt == null
        ? null
        : {
            at: row.overriddenAt,
            by: row.overriddenBy ?? null,
            reason: row.overrideReason ?? null,
          },
  };
}

/** Null legacy columns supply defaults without mutating or backfilling existing rows. */
export function toEdges(
  references: readonly DependencyReferenceRow[],
  mappings: readonly DependencySubTicketMapping[],
  subTickets: readonly { id: string; mappedTicketId?: string | null }[],
): DependencyEdge[] {
  const mappedIds = new Map(subTickets.map((row) => [row.id, row.mappedTicketId]));
  return [
    ...references
      .filter((row) => row.relationType === 'BLOCKS')
      .map(
        (row): DependencyEdge => ({
          ...gating(row),
          id: row.id,
          kind: 'BLOCKS',
          blockerTicketId: row.sourceTicketId,
          dependentTicketId: row.targetTicketId,
          satisfiedStageId: row.satisfiedStageId ?? null,
          reviewNeededAt: row.reviewNeededAt ?? null,
        }),
      ),
    ...mappings.flatMap((row): DependencyEdge[] => {
      const blockerTicketId = mappedIds.get(row.subTicketId);
      return blockerTicketId
        ? [
            {
              ...gating(row),
              id: row.id,
              kind: 'CHILD',
              blockerTicketId,
              dependentTicketId: row.ticketId,
              satisfiedStageId: null,
              reviewNeededAt: null,
            },
          ]
        : [];
    }),
  ];
}

export function isDependencyTerminal(stage: DependencyStage): boolean {
  return stage.defaultTicketStatusV2 === 'COMPLETED' || stage.defaultTicketStatusV2 === 'CANCELLED';
}

// RELEASE uses the existing sequential-stage model, just like DEFAULT.
function isLinear(board: DependencyBoard): boolean {
  return board.boardType === 'DEFAULT' || board.boardType === 'RELEASE';
}

function boardStages(
  board: DependencyBoard,
  stages: readonly DependencyStage[],
): DependencyStage[] {
  return stages
    .filter((stage) => stage.boardId === board.id)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.id.localeCompare(b.id));
}

/** Deleted stages and stages from a previous board fall back to terminal stages. */
export function lockedStageIds(
  board: DependencyBoard,
  stages: readonly DependencyStage[],
  gatedStageId: string | null,
): string[] {
  if (board.boardType === 'FLOW') {
    return [];
  }
  const local = boardStages(board, stages);
  const gated = local.find((stage) => stage.id === gatedStageId);
  return local
    .filter((stage) =>
      !gated
        ? isDependencyTerminal(stage)
        : isLinear(board)
          ? stage.sequenceNumber >= gated.sequenceNumber
          : stage.id === gated.id || isDependencyTerminal(stage),
    )
    .map((stage) => stage.id);
}

/** A latch is checked before the current stage; moving a blocker back cannot un-clear it. */
export function meetsSatisfiedWhen(
  edge: DependencyEdge,
  board: DependencyBoard,
  stages: readonly DependencyStage[],
  enteredStage: DependencyStage,
): boolean {
  if (edge.satisfiedAt != null) {
    return true;
  }
  const local = boardStages(board, stages);
  const entered = local.find((stage) => stage.id === enteredStage.id);
  if (!entered) {
    return false;
  }
  const satisfied = local.find((stage) => stage.id === edge.satisfiedStageId);
  // BLOCKS cancellation needs review, even if it skips a configured satisfied stage.
  // The documented no-COMPLETED-stage fallback is the sole terminal exception.
  if (edge.kind === 'BLOCKS' && entered.defaultTicketStatusV2 === 'CANCELLED') {
    return !satisfied && !local.some((stage) => stage.defaultTicketStatusV2 === 'COMPLETED');
  }
  if (satisfied) {
    return isLinear(board)
      ? entered.sequenceNumber >= satisfied.sequenceNumber
      : entered.id === satisfied.id;
  }
  return edge.kind === 'CHILD' ||
    !local.some((stage) => stage.defaultTicketStatusV2 === 'COMPLETED')
    ? isDependencyTerminal(entered)
    : entered.defaultTicketStatusV2 === 'COMPLETED';
}

export function effectiveStrength(
  edge: DependencyEdge,
  policy: BoardDependencyPolicy,
  gatedStageId: string,
): DependencyStrength {
  return edge.strength === 'HARD' ||
    policy.defaultStrength === 'HARD' ||
    policy.hardGateStageIds.includes(gatedStageId)
    ? 'HARD'
    : 'SOFT';
}

/** This gate classifier is pure; callers must authorize, serialize and persist overrides. */
export function dependencyGate(
  ticket: DependencyTicket,
  targetStageId: string,
  edges: readonly DependencyEdge[],
  context: DependencyContext,
): { hard: DependencyEdge[]; soft: DependencyEdge[] } {
  const result: { hard: DependencyEdge[]; soft: DependencyEdge[] } = {
    hard: [],
    soft: [],
  };
  const board = context.boardsById.get(ticket.boardId);
  if (!board || board.boardType === 'FLOW') {
    return result;
  }
  const stages = boardStages(board, context.stagesByBoard.get(board.id) ?? []);
  const target = stages.find((stage) => stage.id === targetStageId);
  const current = stages.find((stage) => stage.name === ticket.stageName);
  if (
    !target ||
    target.id === current?.id ||
    (isLinear(board) && current && target.sequenceNumber < current.sequenceNumber)
  ) {
    return result;
  }
  const policy = dependencyPolicy(board.metadata);
  for (const edge of edges) {
    if (
      edge.dependentTicketId !== ticket.id ||
      edge.satisfiedAt != null ||
      !lockedStageIds(board, stages, edge.gatedStageId).includes(target.id)
    ) {
      continue;
    }
    // For a default or stale gate, the actual entered terminal stage supplies the policy key.
    const gatedId = stages.find((stage) => stage.id === edge.gatedStageId)?.id ?? target.id;
    result[effectiveStrength(edge, policy, gatedId) === 'HARD' ? 'hard' : 'soft'].push(edge);
  }
  return result;
}

function milliseconds(value: DependencyDate | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const time =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** No synthetic ready date when a related ticket or any necessary duration is unavailable. */
export function blockerReadyDate(edge: DependencyEdge, context: DependencyContext): number | null {
  const ticket = context.ticketsById.get(edge.blockerTicketId);
  const board = ticket && context.boardsById.get(ticket.boardId);
  if (!ticket || !board) {
    return null;
  }
  const stages = boardStages(board, context.stagesByBoard.get(board.id) ?? []);
  const satisfied = stages.find((stage) => stage.id === edge.satisfiedStageId);
  if (!satisfied || isDependencyTerminal(satisfied) || !isLinear(board)) {
    return milliseconds(ticket.eta);
  }
  const current = stages.find((stage) => stage.name === ticket.stageName);
  const deadline = milliseconds(ticket.activeStageEta);
  if (!current || deadline == null) {
    return null;
  }
  const remaining = stages.filter(
    (stage) =>
      stage.sequenceNumber > current.sequenceNumber &&
      stage.sequenceNumber <= satisfied.sequenceNumber,
  );
  if (
    remaining.some((stage) => stage.eta == null || !Number.isFinite(stage.eta) || stage.eta < 0)
  ) {
    return null;
  }
  return deadline + remaining.reduce((sum, stage) => sum + stage.eta!, 0) * 3_600_000;
}

export function deriveDependencyState(
  ticket: DependencyTicket,
  edges: readonly DependencyEdge[],
  context: DependencyContext,
  now: DependencyDate,
): DependencyState {
  const incoming = edges.filter((edge) => edge.dependentTicketId === ticket.id);
  const blockedBy = incoming.filter((edge) => edge.satisfiedAt == null);
  const blocking = edges.filter(
    (edge) => edge.blockerTicketId === ticket.id && edge.satisfiedAt == null,
  );
  const result: DependencyState = { primary: null, blockedBy, blocking };
  const board = context.boardsById.get(ticket.boardId);
  const stages = board ? boardStages(board, context.stagesByBoard.get(board.id) ?? []) : [];
  const current = stages.find((stage) => stage.name === ticket.stageName);
  const next =
    board && isLinear(board)
      ? stages
          .filter((stage) => current && stage.sequenceNumber === current.sequenceNumber + 1)
          .map((stage) => stage.id)
      : (context.nextStageIdsByTicket?.get(ticket.id) ?? []);
  const locked = new Set(
    blockedBy.flatMap((edge) => (board ? lockedStageIds(board, stages, edge.gatedStageId) : [])),
  );
  const eta = milliseconds(ticket.eta);
  const lateBy = blockedBy.map((edge) => {
    const ready = blockerReadyDate(edge, context);
    return eta != null && ready != null ? ready - eta : 0;
  });
  const risk = Math.max(0, ...lateBy);
  const nowMs = milliseconds(now);
  if (next.length > 0 && next.every((id) => locked.has(id))) {
    result.primary = 'Blocked';
  } else if (blockedBy.some((edge) => edge.reviewNeededAt != null)) {
    result.primary = 'Needs review';
  } else if (risk > 0) {
    result.primary = 'At risk';
    result.atRiskDays = Math.ceil(risk / DAY_MS);
  } else if ((current?.defaultTicketStatusV2 ?? ticket.statusV2) === 'PAUSED') {
    result.primary = 'Paused';
  } else if (blockedBy.length > 0 && board?.boardType !== 'FLOW') {
    result.primary = 'Gated later';
  } else if (
    nowMs != null &&
    incoming.some((edge) => {
      const at = milliseconds(edge.satisfiedAt);
      return at != null && at <= nowMs && nowMs - at < DAY_MS;
    })
  ) {
    result.primary = 'Unblocked';
  }
  return result;
}

/**
 * Check a candidate in the combined BLOCKS/CHILD graph. Edits replace their existing edge.
 * Ticket/board context is required: stage ids alone cannot identify a ticket's board.
 * Linear stages have progress arcs; NON_LINEAR tickets collapse to a single node.
 * No recursion, so a deep dependency chain cannot overflow the JS call stack.
 * This returns INTERNAL ticket ids: the server must redact unreadable loop members.
 */
export function findCycle(
  edges: readonly DependencyEdge[],
  candidate: DependencyEdge,
  context: DependencyContext,
): string[] | null {
  const graph = new Map<string, Set<string>>();
  const owners = new Map<string, string>();
  const node = (ticketId: string, stageId: string): string => {
    const key = JSON.stringify([ticketId, stageId]);
    owners.set(key, ticketId);
    return key;
  };
  const add = (from: string, to: string): void => {
    const outgoing = graph.get(from) ?? new Set<string>();
    outgoing.add(to);
    graph.set(from, outgoing);
  };
  const stagesFor = (ticketId: string): { board: DependencyBoard; stages: DependencyStage[] } => {
    const ticket = context.ticketsById.get(ticketId);
    const board = ticket && context.boardsById.get(ticket.boardId);
    if (!board) {
      throw new Error('Cycle check requires complete ticket and board context');
    }
    return {
      board,
      stages: boardStages(board, context.stagesByBoard.get(board.id) ?? []),
    };
  };
  const active = [
    ...edges.filter((edge) => edge.id !== candidate.id || edge.kind !== candidate.kind),
    candidate,
  ].filter((edge) => edge.satisfiedAt == null);
  for (const edge of active) {
    const source = stagesFor(edge.blockerTicketId);
    const target = stagesFor(edge.dependentTicketId);
    if (target.board.boardType === 'FLOW') {
      continue;
    }
    if (edge.blockerTicketId === edge.dependentTicketId) {
      return [edge.blockerTicketId, edge.blockerTicketId];
    }
    if (source.stages.length === 0 || target.stages.length === 0) {
      throw new Error('Cycle check requires complete stage context');
    }
  }
  const collapsed = new Set<string>();
  for (const edge of active) {
    if (stagesFor(edge.blockerTicketId).board.boardType === 'NON_LINEAR') {
      collapsed.add(edge.blockerTicketId);
    }
    if (stagesFor(edge.dependentTicketId).board.boardType === 'NON_LINEAR') {
      collapsed.add(edge.dependentTicketId);
    }
  }
  // Only NON_LINEAR nodes collapse; linear neighbors retain ordered stage nodes.
  const endpoints = (ticketId: string, stageId: string): string =>
    node(ticketId, collapsed.has(ticketId) ? '*' : stageId);
  for (const edge of active) {
    const source = stagesFor(edge.blockerTicketId);
    const target = stagesFor(edge.dependentTicketId);
    if (target.board.boardType === 'FLOW') {
      continue;
    }
    for (const [id, value] of [
      [edge.blockerTicketId, source],
      [edge.dependentTicketId, target],
    ] as const) {
      if (!collapsed.has(id) && isLinear(value.board)) {
        for (let i = 1; i < value.stages.length; i++) {
          add(endpoints(id, value.stages[i - 1].id), endpoints(id, value.stages[i].id));
        }
      }
    }
    const satisfied = source.stages.find((stage) => stage.id === edge.satisfiedStageId);
    let sourceStages = satisfied
      ? [satisfied]
      : source.stages.filter((stage) =>
          edge.kind === 'CHILD'
            ? isDependencyTerminal(stage)
            : stage.defaultTicketStatusV2 === 'COMPLETED',
        );
    if (sourceStages.length === 0) {
      sourceStages = source.stages.filter(isDependencyTerminal);
    }
    const gated = target.stages.find((stage) => stage.id === edge.gatedStageId);
    const targetStages = gated ? [gated] : target.stages.filter(isDependencyTerminal);
    for (const from of sourceStages) {
      for (const to of targetStages) {
        add(endpoints(edge.blockerTicketId, from.id), endpoints(edge.dependentTicketId, to.id));
      }
    }
  }
  const color = new Map<string, number>();
  const path: string[] = [];
  const positions = new Map<string, number>();
  for (const root of graph.keys()) {
    if (color.has(root)) {
      continue;
    }
    const stack = [{ key: root, children: [...(graph.get(root) ?? [])], index: 0 }];
    color.set(root, 1);
    positions.set(root, path.length);
    path.push(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const child = frame.children[frame.index++];
      if (child == null) {
        color.set(frame.key, 2);
        positions.delete(frame.key);
        path.pop();
        stack.pop();
      } else if (color.get(child) === 1) {
        const loop = [...path.slice(positions.get(child)!), child].map((key) => owners.get(key)!);
        return loop.filter((id, i) => i === 0 || id !== loop[i - 1]);
      } else if (!color.has(child)) {
        color.set(child, 1);
        positions.set(child, path.length);
        path.push(child);
        stack.push({
          key: child,
          children: [...(graph.get(child) ?? [])],
          index: 0,
        });
      }
    }
  }
  return null;
}

/** Generic reference mutators must never write dependency rows or convert their type. */
export function assertGenericTicketReference(relationType: string): void {
  if (relationType === 'BLOCKS') {
    throw new Error('BLOCKS dependencies must be changed using dependency mutations');
  }
}
