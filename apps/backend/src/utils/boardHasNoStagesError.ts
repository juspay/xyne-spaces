/**
 * Thrown when a ticket is created on a board that has no stages.
 *
 * A ticket must land on a stage, so this is a board-configuration problem, not a
 * server fault. Callers map it to a 4xx with code `BOARD_HAS_NO_STAGES` so the user
 * sees what to fix instead of a generic "Internal server error".
 */
export class BoardHasNoStagesError extends Error {
  readonly code = 'BOARD_HAS_NO_STAGES' as const;

  constructor(public readonly boardId: string) {
    super(`No stages found for board ${boardId}. Board must have at least one stage.`);
    this.name = 'BoardHasNoStagesError';
  }
}

export const BOARD_HAS_NO_STAGES_USER_MESSAGE =
  'This board has no stages configured, so tickets cannot be created on it. Ask a board admin to add stages in the board settings.';
