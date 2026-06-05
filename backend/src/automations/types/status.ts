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
}

export const AutomationStatusSchema = z.nativeEnum(AutomationStatus);

export function isLiveStatus(status: string): boolean {
  return status === AutomationStatus.ACTIVE || status === AutomationStatus.DISABLED;
}

export function isProposalStatus(status: string): boolean {
  return (
    status === AutomationStatus.DRAFT ||
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
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SKIPPED = 'SKIPPED',
}

export const AutomationRunStatusSchema = z.nativeEnum(AutomationRunStatus);
