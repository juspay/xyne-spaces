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
 * Per-user tickets + engine score, sorted lowest-score-first (= assigned next).
 * When no board is selected, `score` is null and rows sort by weightedActiveTasks.
 */
export function computeAssignmentScores<U extends { id: string }>(params: {
  users: readonly U[];
  workloadMappings: readonly WorkloadMappingLike[] | null | undefined;
  boardComplexityScores: readonly ComplexityScoreLike[] | null | undefined;
  expertiseMappings: readonly ExpertiseMappingLike[] | null | undefined;
  userGroupMappings: readonly UserGroupMappingLike[] | null | undefined;
  boards: readonly BoardLike[];
  selectedBoardId: string | null;
}): AssignmentScoreRow<U>[] {
  const {
    users,
    workloadMappings,
    boardComplexityScores,
    expertiseMappings,
    userGroupMappings,
    boards,
    selectedBoardId,
  } = params;

  const weightByBoard = buildWeightByBoard(boardComplexityScores);
  const projectBoardIds = computeProjectBoardIds(boards, selectedBoardId);
  const totalTicketsOnBoard = computeTotalTicketsOnBoard(workloadMappings, selectedBoardId);
  const expertiseByUser = new Map((expertiseMappings ?? []).map(e => [e.userId, e] as const));
  const startOffsetByUser = new Map(
    (userGroupMappings ?? []).map(m => [m.userId, m.startOffset ?? 0] as const),
  );

  return users
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
      const score = selectedBoardId
        ? effectiveActiveTasks - expertiseBonus - (percentage - currentPct)
        : null;
      return {
        user,
        userTickets,
        totalActive,
        weightedActiveTasks,
        startOffset,
        effectiveActiveTasks,
        hasExpertise,
        score,
      };
    })
    .sort((a, b) => (a.score ?? a.effectiveActiveTasks) - (b.score ?? b.effectiveActiveTasks));
}
