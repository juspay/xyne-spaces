/**
 * Types for Board Form functionality
 */

import type { ReadonlyJSONValue } from '@rocicorp/zero';

// Export types for external use
export interface BoardStageData {
  name: string;
  eta: number;
  sequenceNumber: number;
}

export interface CreateBoardFormData {
  name: string;
  projectId: string;
  stages: BoardStageData[];
}

export interface UpdateBoardFormData {
  name?: string;
  projectId?: string;
  metadata?: ReadonlyJSONValue;
  stages?: BoardStageData[];
  formIds?: string[] | null;
}

export type BoardFormData = CreateBoardFormData | UpdateBoardFormData;

export interface BoardFormProps {
  board?: import('../BoardCard').BoardWithStages;
  onSubmit: (data: BoardFormData) => Promise<void> | void;
  onCancel: () => void;
  loading?: boolean;
  projectId?: string;
}
