import { BoardType, TicketStatusV2 } from '@xyne/shared';

/**
 * Pure stage resolution for "release completed → move dev ticket to a
 * Completed-group stage". No I/O so it can be unit tested exhaustively; the
 * service layer loads the board, stages, transitions and Standard Path and
 * passes them in.
 *
 * Resolution order (first hit wins):
 *   1. CONFIGURED    — `Board.metadata.releaseCompletion.stageName`, only if
 *                      that stage exists on the board AND is in the COMPLETED
 *                      status group.
 *   2. LINEAR        — DEFAULT / RELEASE boards: the lowest-sequenceNumber
 *                      COMPLETED stage *after* the current stage (never moves a
 *                      ticket "back" to an earlier Completed stage).
 *   2. STANDARD_PATH — NON_LINEAR boards with a Standard Path: the first
 *                      COMPLETED stage on the path after the ticket's position
 *                      (or the first COMPLETED stage on the path when the
 *                      ticket is off-path).
 *   3. REACHABLE     — NON_LINEAR / FLOW: BFS over stage_transitions
 *                      (explicit + global edges; a stage with no outgoing
 *                      explicit edges is unrestricted, mirroring
 *                      ticketStageTransitionService). Nearest COMPLETED stage
 *                      wins, ties broken by lower sequenceNumber.
 *   4. FALLBACK      — lowest-sequenceNumber COMPLETED stage on the board.
 *                      Not used for FLOW boards (their plan graph is owned by
 *                      the flow engine; we only move them along a configured
 *                      or reachable edge).
 */

export interface CompletionStage {
  id: string;
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2: string | null;
}

export interface CompletionTransition {
  fromStageId: string | null;
  toStageId: string;
}

export interface ResolveReleaseCompletionStageInput {
  boardType: string;
  stages: ReadonlyArray<CompletionStage>;
  transitions: ReadonlyArray<CompletionTransition>;
  standardPathStageIds: ReadonlyArray<string>;
  currentStageName: string | null;
  configuredStageName?: string | null;
}

export type ReleaseCompletionSource = 'CONFIGURED' | 'LINEAR' | 'STANDARD_PATH' | 'REACHABLE' | 'FALLBACK';

export type ReleaseCompletionResolution =
  | {
      kind: 'TARGET';
      stage: CompletionStage;
      /** Which tier picked the stage — logged for observability. */
      source: ReleaseCompletionSource;
      /**
       * The stage the ticket enters `stage` from on the resolved route. Used to
       * find the incoming edge whose approval gate must be honoured. Equals the
       * current stage for a direct jump; null when the current stage is unknown.
       */
      enteredFromStageId: string | null;
    }
  | { kind: 'ALREADY_COMPLETED' }
  | { kind: 'NO_TARGET'; reason: string };

const isCompleted = (s: CompletionStage) => s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED;

const bySequence = (a: CompletionStage, b: CompletionStage) => a.sequenceNumber - b.sequenceNumber;

export function resolveReleaseCompletionStage(
  input: ResolveReleaseCompletionStageInput,
): ReleaseCompletionResolution {
  const { boardType, stages, transitions, standardPathStageIds, currentStageName, configuredStageName } = input;

  const current = currentStageName ? stages.find(s => s.name === currentStageName) ?? null : null;
  if (current && isCompleted(current)) return { kind: 'ALREADY_COMPLETED' };

  const completed = stages.filter(isCompleted).sort(bySequence);
  if (completed.length === 0) {
    return { kind: 'NO_TARGET', reason: 'Board has no stage in the COMPLETED status group' };
  }

  const currentId = current?.id ?? null;
  const target = (
    stage: CompletionStage,
    source: ReleaseCompletionSource,
    enteredFromStageId: string | null = currentId,
  ): ReleaseCompletionResolution => ({ kind: 'TARGET', stage, source, enteredFromStageId });

  // ── 1. Admin-configured stage ─────────────────────────────────────────────
  if (configuredStageName) {
    const configured = completed.find(s => s.name === configuredStageName);
    if (configured) return target(configured, 'CONFIGURED');
    // Misconfigured (renamed/deleted stage or not COMPLETED) → fall through.
  }

  // ── 2/4. Linear boards ────────────────────────────────────────────────────
  if (boardType === BoardType.DEFAULT || boardType === BoardType.RELEASE) {
    const after = current ? completed.find(s => s.sequenceNumber > current.sequenceNumber) : undefined;
    if (after) return target(after, 'LINEAR');
    return target(completed[0]!, 'FALLBACK');
  }

  // ── 2. Standard Path (NON_LINEAR) ─────────────────────────────────────────
  if (boardType === BoardType.NON_LINEAR && standardPathStageIds.length > 0) {
    const byId = new Map(stages.map(s => [s.id, s]));
    const position = currentId ? standardPathStageIds.indexOf(currentId) : -1;
    const searchFrom = position === -1 ? 0 : position + 1;
    for (let i = searchFrom; i < standardPathStageIds.length; i++) {
      const stage = byId.get(standardPathStageIds[i]!);
      if (stage && isCompleted(stage)) {
        // On-path: entered from the previous path stage. Off-path: direct jump.
        const enteredFrom = position === -1 ? currentId : standardPathStageIds[i - 1] ?? currentId;
        return target(stage, 'STANDARD_PATH', enteredFrom);
      }
    }
  }

  // ── 3. Nearest reachable Completed stage (NON_LINEAR / FLOW) ──────────────
  if (currentId) {
    const reached = nearestReachableCompleted(currentId, stages, transitions);
    if (reached) return target(reached.stage, 'REACHABLE', reached.enteredFromStageId);
  }

  if (boardType === BoardType.FLOW) {
    return {
      kind: 'NO_TARGET',
      reason: 'FLOW board: no configured releaseCompletion stage and no Completed stage reachable from the current stage',
    };
  }

  // ── 4. Last resort ────────────────────────────────────────────────────────
  return target(completed[0]!, 'FALLBACK');
}

function nearestReachableCompleted(
  startId: string,
  stages: ReadonlyArray<CompletionStage>,
  transitions: ReadonlyArray<CompletionTransition>,
): { stage: CompletionStage; enteredFromStageId: string } | null {
  const byId = new Map(stages.map(s => [s.id, s]));
  const allIds = stages.map(s => s.id);
  const globalTargets = transitions.filter(t => t.fromStageId == null).map(t => t.toStageId);
  const explicit = new Map<string, string[]>();
  for (const t of transitions) {
    if (t.fromStageId == null) continue;
    const list = explicit.get(t.fromStageId) ?? [];
    list.push(t.toStageId);
    explicit.set(t.fromStageId, list);
  }
  const neighbours = (id: string): string[] => {
    const out = explicit.get(id);
    // No outgoing explicit edges → unrestricted (matches transitionTicket).
    if (!out || out.length === 0) return allIds;
    return [...out, ...globalTargets];
  };

  const parent = new Map<string, string>();
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbours(id)) {
        if (visited.has(n) || !byId.has(n)) continue;
        visited.add(n);
        parent.set(n, id);
        next.push(n);
      }
    }
    const hits = next.map(id => byId.get(id)!).filter(isCompleted).sort(bySequence);
    if (hits.length > 0) {
      const stage = hits[0]!;
      return { stage, enteredFromStageId: parent.get(stage.id)! };
    }
    frontier = next;
  }
  return null;
}
