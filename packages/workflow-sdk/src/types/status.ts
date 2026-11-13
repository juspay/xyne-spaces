import { z } from 'zod';

export enum WorkflowStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
  AUTO_REVOKED = 'AUTO_REVOKED',
  ARCHIVED = 'ARCHIVED',
}

export const WorkflowStatusSchema = z.nativeEnum(WorkflowStatus);

export function isLiveStatus(status: string): boolean {
  return (
    status === WorkflowStatus.ACTIVE || status === WorkflowStatus.DISABLED
  );
}

export function isProposalStatus(status: string): boolean {
  return (
    status === WorkflowStatus.DRAFT ||
    status === WorkflowStatus.PENDING_APPROVAL ||
    status === WorkflowStatus.REJECTED ||
    status === WorkflowStatus.REVOKED ||
    status === WorkflowStatus.AUTO_REVOKED
  );
}

export function isTerminalProposalStatus(status: string): boolean {
  return (
    status === WorkflowStatus.REJECTED ||
    status === WorkflowStatus.REVOKED ||
    status === WorkflowStatus.AUTO_REVOKED
  );
}

export enum ExecutionStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SKIPPED = 'SKIPPED',
  EXTERNAL_WAIT = 'EXTERNAL_WAIT',
}

export const ExecutionStatusSchema = z.nativeEnum(ExecutionStatus);
