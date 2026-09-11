import { BoardType } from '@xyne/shared';
import type { Stage, StageApprovers, Application } from '@xyne/shared';
import type { ReadonlyJSONValue } from '@rocicorp/zero';

export interface StageWithApprovers extends Stage {
  approvers?: readonly StageApprovers[];
}

// Board type from Zero query with related stages
export interface BoardWithStages {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly boardType: BoardType;
  readonly projectId: string;
  readonly createdBy: string;
  readonly updatedBy: string | null;
  readonly createdAt: number;
  readonly updatedAt: number | null;
  readonly metadata?: ReadonlyJSONValue;
  readonly flowPlan?: string | null;
  readonly stages?: readonly StageWithApprovers[] | Error;
  readonly applications?: readonly Application[] | Error;
}

export function getBoardEditLabel(
  board: BoardWithStages,
  applicationBoardIds?: Set<string>,
): string {
  if (board.boardType === BoardType.FLOW) {
    return 'Edit Plan';
  }
  if (board.boardType !== BoardType.RELEASE) {
    return 'Edit';
  }
  if (applicationBoardIds) {
    return applicationBoardIds.has(board.id) ? 'Edit Service Config' : 'Edit Repository';
  }
  const apps = board.applications;
  if (apps === undefined || apps instanceof Error || !Array.isArray(apps) || apps.length === 0) {
    return 'Edit Repository';
  }
  return 'Edit Repository Config';
}
