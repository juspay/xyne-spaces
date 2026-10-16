import { TicketStatusV2 } from '@xyne/shared';

/**
 * Stages every DEFAULT / NON_LINEAR board starts with. Mirrors the template the dashboard's
 * BoardStageConfigScreen pre-fills, so a board created through the API and a board created
 * through the "Create board" wizard look the same. It also satisfies the board.update mutator's
 * rule that a board must have at least one TODO, STARTED and COMPLETED stage.
 */
export const DEFAULT_BOARD_STAGES = [
  { name: 'BACKLOG', sequenceNumber: 1, defaultTicketStatusV2: TicketStatusV2.TODO },
  { name: 'IN PROGRESS', sequenceNumber: 2, defaultTicketStatusV2: TicketStatusV2.STARTED },
  { name: 'COMPLETED', sequenceNumber: 3, defaultTicketStatusV2: TicketStatusV2.COMPLETED },
  { name: 'NOT REQUIRED', sequenceNumber: 4, defaultTicketStatusV2: TicketStatusV2.CANCELLED },
] as const;
