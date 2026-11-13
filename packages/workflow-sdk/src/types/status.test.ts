import { describe, it, expect } from 'vitest';
import {
  WorkflowStatus,
  ExecutionStatus,
  WorkflowStatusSchema,
  ExecutionStatusSchema,
  isLiveStatus,
  isProposalStatus,
  isTerminalProposalStatus,
} from './status.js';

describe('WorkflowStatus', () => {
  it('has expected enum values', () => {
    expect(WorkflowStatus.DRAFT).toBe('DRAFT');
    expect(WorkflowStatus.ACTIVE).toBe('ACTIVE');
    expect(WorkflowStatus.DISABLED).toBe('DISABLED');
    expect(WorkflowStatus.ARCHIVED).toBe('ARCHIVED');
  });
});

describe('WorkflowStatusSchema', () => {
  it('parses valid status', () => {
    expect(WorkflowStatusSchema.parse('ACTIVE')).toBe(WorkflowStatus.ACTIVE);
  });

  it('rejects invalid status', () => {
    expect(() => WorkflowStatusSchema.parse('INVALID')).toThrow();
  });
});

describe('ExecutionStatus', () => {
  it('has expected enum values', () => {
    expect(ExecutionStatus.PENDING).toBe('PENDING');
    expect(ExecutionStatus.RUNNING).toBe('RUNNING');
    expect(ExecutionStatus.COMPLETED).toBe('COMPLETED');
    expect(ExecutionStatus.FAILED).toBe('FAILED');
    expect(ExecutionStatus.EXTERNAL_WAIT).toBe('EXTERNAL_WAIT');
  });
});

describe('ExecutionStatusSchema', () => {
  it('parses valid status', () => {
    expect(ExecutionStatusSchema.parse('RUNNING')).toBe(
      ExecutionStatus.RUNNING,
    );
  });

  it('rejects invalid status', () => {
    expect(() => ExecutionStatusSchema.parse('NOPE')).toThrow();
  });
});

describe('isLiveStatus', () => {
  it('returns true for ACTIVE', () => {
    expect(isLiveStatus(WorkflowStatus.ACTIVE)).toBe(true);
  });

  it('returns true for DISABLED', () => {
    expect(isLiveStatus(WorkflowStatus.DISABLED)).toBe(true);
  });

  it('returns false for DRAFT', () => {
    expect(isLiveStatus(WorkflowStatus.DRAFT)).toBe(false);
  });

  it('returns false for ARCHIVED', () => {
    expect(isLiveStatus(WorkflowStatus.ARCHIVED)).toBe(false);
  });

  it('returns false for arbitrary string', () => {
    expect(isLiveStatus('FOO')).toBe(false);
  });
});

describe('isProposalStatus', () => {
  it('returns true for DRAFT', () => {
    expect(isProposalStatus(WorkflowStatus.DRAFT)).toBe(true);
  });

  it('returns true for PENDING_APPROVAL', () => {
    expect(isProposalStatus(WorkflowStatus.PENDING_APPROVAL)).toBe(true);
  });

  it('returns true for REJECTED', () => {
    expect(isProposalStatus(WorkflowStatus.REJECTED)).toBe(true);
  });

  it('returns true for REVOKED', () => {
    expect(isProposalStatus(WorkflowStatus.REVOKED)).toBe(true);
  });

  it('returns true for AUTO_REVOKED', () => {
    expect(isProposalStatus(WorkflowStatus.AUTO_REVOKED)).toBe(true);
  });

  it('returns false for ACTIVE', () => {
    expect(isProposalStatus(WorkflowStatus.ACTIVE)).toBe(false);
  });
});

describe('isTerminalProposalStatus', () => {
  it('returns true for REJECTED', () => {
    expect(isTerminalProposalStatus(WorkflowStatus.REJECTED)).toBe(true);
  });

  it('returns true for REVOKED', () => {
    expect(isTerminalProposalStatus(WorkflowStatus.REVOKED)).toBe(true);
  });

  it('returns true for AUTO_REVOKED', () => {
    expect(isTerminalProposalStatus(WorkflowStatus.AUTO_REVOKED)).toBe(true);
  });

  it('returns false for DRAFT', () => {
    expect(isTerminalProposalStatus(WorkflowStatus.DRAFT)).toBe(false);
  });

  it('returns false for PENDING_APPROVAL', () => {
    expect(isTerminalProposalStatus(WorkflowStatus.PENDING_APPROVAL)).toBe(
      false,
    );
  });
});
