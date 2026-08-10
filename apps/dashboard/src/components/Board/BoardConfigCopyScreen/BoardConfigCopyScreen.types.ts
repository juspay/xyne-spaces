import type { TicketStatusV2 } from '@xyne/shared';

// Mirrors the backend's `ApiResponse<T>` envelope (apps/backend/src/types/express.ts) —
// every board-config-copy endpoint wraps its payload as `data`, not the response body itself.
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface CopyCategorySelection {
  customFields: boolean;
  roles: boolean;
  stages: boolean;
}

export interface StageRemapOverride {
  oldStageId: string;
  newStageId: string;
}

export interface OldStageInfo {
  id: string;
  name: string;
  defaultTicketStatusV2: TicketStatusV2;
  ticketCount: number;
}

export interface NewStageInfo {
  // Id of the SOURCE board's stage this translated stage was copied from — the new stage
  // itself doesn't exist yet at plan time, so this doubles as the identifier used in
  // `suggestedMapping`/`requiresExplicit`/`StageRemapOverride.newStageId`.
  sourceStageId: string;
  name: string;
  defaultTicketStatusV2: TicketStatusV2;
  sequenceNumber: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  boardType: string;
}

// Fields beyond `errors`/`warnings` are only populated when validation passes and
// `categories.stages` was requested — mirrors apps/backend/src/services/boardConfigCopyService.ts's
// `PlanCopyResult` exactly (do not widen these back to required without checking that file).
export interface PlanCopyResult {
  errors: string[];
  warnings: string[];
  sourceBoard?: BoardSummary;
  targetBoard?: BoardSummary;
  newStages?: NewStageInfo[];
  oldStages?: OldStageInfo[];
  suggestedMapping?: Record<string, string>;
  requiresExplicit?: string[];
}

export interface ExecuteCopyStagesSummary {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  failedTicketIds: string[];
  newStageCount: number;
  deletedOldStageCount: number;
}

export interface ExecuteCopySummary {
  customFieldsCopied: boolean;
  rolesCopied: boolean;
  // Object-storage path of the pre-copy backup of the target board, kept for 7 days.
  snapshotPath?: string;
  stages?: ExecuteCopyStagesSummary;
  warnings: string[];
}

export interface ExecuteCopyResponse {
  jobId?: string;
  summary?: ExecuteCopySummary;
}

export interface JobStatusProgress {
  processed: number;
  total: number;
  batches: number;
}

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

export interface JobStatusResponse {
  state: JobState;
  progress?: JobStatusProgress;
  result?: ExecuteCopySummary;
  failedReason?: string;
}
