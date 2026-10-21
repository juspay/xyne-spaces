import type {  Stage, StageTransition } from '@prisma/client';
import { TicketStatusV2,  type BoardEtaManagement } from '@xyne/shared';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  TicketStatusV2.COMPLETED,
  TicketStatusV2.CANCELLED,
]);

export function isTerminalStatus(statusV2: string): boolean {
  return TERMINAL_STATUSES.has(statusV2);
}

export interface LoadedBoardEtaContext {
  boardType: string;
  boardEtaManagement: BoardEtaManagement;
  stages: Array<Pick<Stage, 'id' | 'sequenceNumber' | 'eta'>>;
  transitions: StageTransition[];
}
