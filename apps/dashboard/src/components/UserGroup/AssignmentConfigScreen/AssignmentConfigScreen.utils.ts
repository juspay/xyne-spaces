// Pure helpers for the Assignment Config "Visibility" tab.
// Replicates the backend `pickBest` per-user score (assignmentEngine.ts) from
// already-synced Zero data — no backend call:
//   effectiveActiveTasks = weightedActiveTasks + (startOffset ?? 0)
//   score = effectiveActiveTasks − expertiseBonus − (percentage − currentPct)
//
// startOffset is the cold-start fairness offset (see cold-start-fairness-design.md):
// a one-time, persisted value on user_group_mappings that keeps a brand-new member's
// effective load at parity with established peers instead of flooding them from 0.
// It's a single aggregate per (user, group) — not per board — so it's added
// unconditionally regardless of which board is selected.

import { AssignmentStrategy } from '@xyne/shared';

export interface AssignmentStateLike {
  userId: string;
  lastAssignedAt: number | null | undefined;
}

export interface WorkloadMappingLike {
  userId: string;
  boardId: string;
  activeTasks: number | null;
}

export interface UserGroupMappingLike {
  userId: string;
  startOffset: number | null;
}

export interface ComplexityScoreLike {
  boardId: string;
  weight: number | null;
  /** "Use percentage assignment" — when false/unset the percentDiff term is not applied. */
  usePercentage?: boolean | null;
}

export interface ExpertiseMappingLike {
  userId: string;
  hasExpertise: boolean;
  percentage: number | null;
}

export interface BoardLike {
  id: string;
  projectId: string;
}

export interface AssignmentScoreRow<U> {
  user: U;
  /** Open (TODO/STARTED) tickets on the selected board, or total across boards when none selected. */
  userTickets: number;
  /** Total open tickets across all boards. */
  totalActive: number;
  /** Σ activeTasks × boardWeight, scoped to the selected board's project. */
  weightedActiveTasks: number;
  /** One-time cold-start offset from user_group_mappings.startOffset (0 for established members). */
  startOffset: number;
  /** weightedActiveTasks + startOffset — what the engine actually scores on. */
  effectiveActiveTasks: number;
  hasExpertise: boolean;
  /** Engine score for the selected board; null when no board is selected. */
  score: number | null;
  /**
   * Display-only version of `score`, shifted so the lowest score among the
   * currently shown rows reads as 0 (percentDiff can swing scores very
   * negative, e.g. percentage=100 vs 0% share = -100, which reads as broken
   * rather than "lowest wins"). Never used for sorting or any real decision —
   * only `score` is real. Same value as `score` when nothing needed shifting.
   */
  displayScore: number | null;
  /**
   * True when weightedActiveTasks (raw, not effective) is at or above
   * user_groups.maxWorkload. Mirrors the engine's hard cap — at capacity, this
   * member is skipped for new assignments. Always false when no cap is set.
   */
  isAtCapacity: boolean;
  lastAssignedAt: number | null;
}

/** boardId → weight (defaults to 1 when a board has no complexity score row). */
export function buildWeightByBoard(
  boardComplexityScores: readonly ComplexityScoreLike[] | null | undefined,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of boardComplexityScores ?? []) m.set(s.boardId, s.weight ?? 1);
  return m;
}

/** Boards in the same project as the selected board (weightedActiveTasks is project-scoped). */
export function computeProjectBoardIds(
  boards: readonly BoardLike[],
  selectedBoardId: string | null,
): Set<string> | null {
  if (!selectedBoardId) return null;
  const selected = boards.find(b => b.id === selectedBoardId);
  if (!selected) return null;
  return new Set(boards.filter(b => b.projectId === selected.projectId).map(b => b.id));
}

/**
 * Whether the percentDiff term applies to the selected board. Mirrors the engine:
 * percentDiff is gated on board_complexity_scores.usePercentage for the target board
 * (assignmentEngine.ts `usePercentageForBoard`).
 */
export function computeUsePercentageForBoard(
  boardComplexityScores: readonly ComplexityScoreLike[] | null | undefined,
  selectedBoardId: string | null,
): boolean {
  if (!selectedBoardId) return false;
  return (
    (boardComplexityScores ?? []).find(s => s.boardId === selectedBoardId)?.usePercentage === true
  );
}

/** Σ activeTasks across all members on the selected board (0 when no board selected). */
export function computeTotalTicketsOnBoard(
  workloadMappings: readonly WorkloadMappingLike[] | null | undefined,
  selectedBoardId: string | null,
): number {
  if (!selectedBoardId) return 0;
  return (workloadMappings ?? [])
    .filter(w => w.boardId === selectedBoardId)
    .reduce((sum, w) => sum + (w.activeTasks ?? 0), 0);
}

/**
 * Per-user tickets + engine score, ordered so the row assigned next comes first.
 * When no board is selected, `score` is null and rows sort by weightedActiveTasks.
 */
export function computeAssignmentScores<U extends { id: string }>(params: {
  users: readonly U[];
  workloadMappings: readonly WorkloadMappingLike[] | null | undefined;
  boardComplexityScores: readonly ComplexityScoreLike[] | null | undefined;
  expertiseMappings: readonly ExpertiseMappingLike[] | null | undefined;
  userGroupMappings: readonly UserGroupMappingLike[] | null | undefined;
  assignmentStates?: readonly AssignmentStateLike[] | null | undefined;
  boards: readonly BoardLike[];
  selectedBoardId: string | null;
  /** user_groups.maxWorkload — group-level cap, or null/undefined when unlimited. */
  maxWorkload?: number | null;
  strategy?: AssignmentStrategy;
}): AssignmentScoreRow<U>[] {
  const {
    users,
    workloadMappings,
    boardComplexityScores,
    expertiseMappings,
    userGroupMappings,
    assignmentStates,
    boards,
    selectedBoardId,
    maxWorkload,
    strategy = AssignmentStrategy.WORKLOAD,
  } = params;

  const weightByBoard = buildWeightByBoard(boardComplexityScores);
  const projectBoardIds = computeProjectBoardIds(boards, selectedBoardId);
  const totalTicketsOnBoard = computeTotalTicketsOnBoard(workloadMappings, selectedBoardId);
  const usePercentageForBoard = computeUsePercentageForBoard(
    boardComplexityScores,
    selectedBoardId,
  );
  const expertiseByUser = new Map((expertiseMappings ?? []).map(e => [e.userId, e] as const));
  const startOffsetByUser = new Map(
    (userGroupMappings ?? []).map(m => [m.userId, m.startOffset ?? 0] as const),
  );
  const lastAssignedByUser = new Map(
    (assignmentStates ?? []).map(s => [s.userId, s.lastAssignedAt] as const),
  );

  const rows = users
    .map(user => {
      const userRows = (workloadMappings ?? []).filter(w => w.userId === user.id);
      const scopedRows = projectBoardIds
        ? userRows.filter(w => projectBoardIds.has(w.boardId))
        : userRows;
      const weightedActiveTasks = scopedRows.reduce(
        (sum, w) => sum + (w.activeTasks ?? 0) * (weightByBoard.get(w.boardId) ?? 1),
        0,
      );
      const startOffset = startOffsetByUser.get(user.id) ?? 0;
      const effectiveActiveTasks = weightedActiveTasks + startOffset;
      const totalActive = userRows.reduce((sum, w) => sum + (w.activeTasks ?? 0), 0);
      const userTickets = selectedBoardId
        ? (userRows.find(w => w.boardId === selectedBoardId)?.activeTasks ?? 0)
        : totalActive;
      const em = expertiseByUser.get(user.id);
      const hasExpertise = em?.hasExpertise === true;
      const percentage = em?.percentage ?? 100;
      const expertiseBonus = hasExpertise ? 10 : 0;
      const currentPct = totalTicketsOnBoard > 0 ? (userTickets / totalTicketsOnBoard) * 100 : 0;
      const percentDiff = usePercentageForBoard ? percentage - currentPct : 0;
      const score = selectedBoardId ? effectiveActiveTasks - expertiseBonus - percentDiff : null;

      const isAtCapacity =
        maxWorkload !== null && maxWorkload !== undefined && weightedActiveTasks >= maxWorkload;
      const lastAssignedAt = lastAssignedByUser.get(user.id) ?? null;
      return {
        user,
        userTickets,
        totalActive,
        weightedActiveTasks,
        startOffset,
        effectiveActiveTasks,
        hasExpertise,
        score,
        isAtCapacity,
        lastAssignedAt,
      };
    })
    .sort((a, b) => (a.score ?? a.effectiveActiveTasks) - (b.score ?? b.effectiveActiveTasks));

  // Mirrors the engine: cursor only, relying on sort stability for the tiebreak.
  if (strategy === AssignmentStrategy.ROUND_ROBIN) {
    rows.sort((a, b) => (a.lastAssignedAt ?? -1) - (b.lastAssignedAt ?? -1));
  }

  const realScores = rows.map(r => r.score).filter((s): s is number => s !== null);
  const minScore = realScores.length > 0 ? Math.min(...realScores) : 0;
  const shift = minScore < 0 ? -minScore : 0;

  return rows.map(row => ({
    ...row,
    displayScore: row.score !== null ? row.score + shift : null,
  }));
}
