/**
 * Types for Board Form functionality
 */

import type { ReadonlyJSONValue } from '@rocicorp/zero';
import type { BoardType } from '@xyne/shared';

import type { TicketStatusV2, PRStatusEvent } from '@xyne/shared';

// Export types for external use
export interface BoardStageData {
  id?: string;
  name: string;
  eta: number;
  sequenceNumber: number;
  defaultTicketStatusV2?: TicketStatusV2;
  prStatuses?: PRStatusEvent[];
  approverIds?: string[];
  formId?: string; // Optional form for approval
}

export interface CreateBoardFormData {
  name: string;
  projectId: string;
  boardType: BoardType;
  stages: BoardStageData[];
}

export interface UpdateBoardFormData {
  name?: string;
  projectId?: string;
  boardType?: BoardType;
  metadata?: ReadonlyJSONValue;
  stages?: BoardStageData[];
  formIds?: string[] | null;
  stageFormMappings?: Array<{
    stageId: string;
    formId: string;
    mappingId: string;
  }>;
  stageApprovers?: Array<{
    stageId: string;
    approverIds: string[];
  }>;
}

export type BoardFormData = CreateBoardFormData | UpdateBoardFormData;

export interface BoardFormProps {
  board?: import('../BoardCard').BoardWithStages;
  onSubmit: (data: BoardFormData) => Promise<void> | void;
  onCancel: () => void;
  loading?: boolean;
  projectId?: string;
}
