import { z } from 'zod';

export enum AutomationStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
  AUTO_REVOKED = 'AUTO_REVOKED',
  ARCHIVED = 'ARCHIVED',
  /** Pre-approval recording: matching events are captured as HELD runs, never queued. */
  PLAYGROUND = 'PLAYGROUND',
}

export const AutomationStatusSchema = z.nativeEnum(AutomationStatus);

export function isLiveStatus(status: string): boolean {
  return status === AutomationStatus.ACTIVE || status === AutomationStatus.DISABLED;
}

export function isProposalStatus(status: string): boolean {
  return (
    status === AutomationStatus.DRAFT ||
    status === AutomationStatus.PLAYGROUND ||
    status === AutomationStatus.PENDING_APPROVAL ||
    status === AutomationStatus.REJECTED ||
    status === AutomationStatus.REVOKED ||
    status === AutomationStatus.AUTO_REVOKED
  );
}

export function isTerminalProposalStatus(status: string): boolean {
  return (
    status === AutomationStatus.REJECTED ||
    status === AutomationStatus.REVOKED ||
    status === AutomationStatus.AUTO_REVOKED
  );
}

export enum AutomationRunStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  EXTERNAL_WAIT = 'EXTERNAL_WAIT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SKIPPED = 'SKIPPED',
  /** Captured by a PLAYGROUND automation; waits for a manual Play. Never queued while HELD. */
  HELD = 'HELD',
}

/** `workflow_executions.tag` marking a run captured by a PLAYGROUND automation. */
export const PLAYGROUND_RUN_TAG = 'playground';

/** A played playground run keeps running whatever status its automation moves to later. */
export function isPlaygroundRun(run: { tag: string | null }): boolean {
  return run.tag === PLAYGROUND_RUN_TAG;
}

export const AutomationRunStatusSchema = z.nativeEnum(AutomationRunStatus);
