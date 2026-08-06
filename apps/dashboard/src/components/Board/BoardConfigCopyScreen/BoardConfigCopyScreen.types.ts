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

// ─── Prepared mutation payloads ───────────────────────────────────────────
// `/prepare` does only what a browser can't (the pre-copy snapshot and the custom-fields
// form clone) and hands these back. The screen passes them straight into the SAME Zero
// mutators the board editor uses, so copying a configuration commits through exactly the
// same path as editing one by hand. Mirrors apps/backend/src/services/boardConfigCopyService.ts.

export interface PreparedStage {
  id: string;
  name: string;
  eta?: number;
  sequenceNumber: number;
  defaultTicketStatusV2: string;
  requestApprovalOnEntry: boolean;
  prStatuses: string[];
  approvers: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
  formId?: string;
}

export interface PreparedBoardUpdate {
  boardId: string;
  boardType: string;
  // Complete replacement blob — `board.update` overwrites metadata rather than merging.
  metadata: Record<string, unknown>;
  // Absent when stages weren't selected. When present this is the board's complete desired
  // stage set: `board.update` upserts these and deletes every stage not listed, which is
  // what retires the target's old stages.
  stages?: PreparedStage[];
  prStatusMappingIds?: Record<string, string>;
}

export interface PreparedBoardFormMapping {
  contextId: string;
  contextType: string;
  entityType: string;
  formId: string;
  mappingId: string;
}

export interface PreparedTransition {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  formId?: string;
  requiresApproval: boolean;
  bypassApprovalForAutomation: boolean;
  requestApprovalOnEntry: boolean;
  visitSlaMode?: string;
  fixedEtaHours?: number | null;
  onReenter?: string;
  approvers: Array<{ id: string; approverId: string; approverType: string }>;
}

/** The committable half — present only once the plan is fully resolved and `dryRun` is false. */
export interface PreparedCopy {
  // Object-storage path of the pre-copy backup of the target board, kept for 7 days.
  snapshotPath: string;
  customFieldsCopied: boolean;
  rolesCopied: boolean;
  newStageCount: number;
  deletedOldStageCount: number;
  ticketsToMigrate: number;
  boardUpdate: PreparedBoardUpdate;
  boardFormMapping: PreparedBoardFormMapping | null;
  transitions: PreparedTransition[] | null;
  // The per-ticket work left over, or null when there is none. Passed back verbatim to
  // /start-ticket-migration after the configuration mutations land — the server re-validates
  // every destination in it, so the screen treats it as an opaque blob.
  ticketMigration: Record<string, unknown> | null;
}

/**
 * One response covering both halves of `/prepare`. The descriptive fields are always
 * returned once the board pair validates — they're what the remap picker renders from —
 * while `prepared` is added only on a call that actually committed to the server-side work.
 * Mirrors apps/backend/src/services/boardConfigCopyService.ts's `PrepareCopyResult`.
 */
export interface PrepareCopyResult {
  errors: string[];
  warnings: string[];
  sourceBoard?: BoardSummary;
  targetBoard?: BoardSummary;
  newStages?: NewStageInfo[];
  oldStages?: OldStageInfo[];
  suggestedMapping?: Record<string, string>;
  requiresExplicit?: string[];
  prepared?: PreparedCopy;
}

/**
 * What the result step renders — the config half returned by /prepare, applied through the
 * Zero mutators. There is no ticket-migration result: that job runs in the background with
 * no status endpoint to report through, by design (see BoardConfigCopyScreen.tsx).
 */
export interface CopyResultSummary {
  customFieldsCopied: boolean;
  rolesCopied: boolean;
  snapshotPath?: string;
  newStageCount: number;
  deletedOldStageCount: number;
  warnings: string[];
}
