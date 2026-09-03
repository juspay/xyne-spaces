/**
 * Automations Operation Registry
 *
 * Event-triggered automations and the workflows they belong to.
 *
 * Automations move through an approval lifecycle rather than being switched on
 * directly: a proposal is submitted, approved or rejected, then activated. The
 * operations here follow that sequence, and each is a distinct mutator so the
 * transitions stay auditable.
 */

import { op } from './types.js';
import type { Workflow } from '../types/index.js';

/** Page cursor for the workflow listing. */
export interface WorkflowCursor {
  id: string;
  createdAt: number;
}

export const automationsOperations = {
  // ----- Reads -----

  /**
   * Every automation.
   */
  list: op<void, Workflow[]>('automations.list', 'query'),

  /**
   * One automation.
   */
  get: op<{ id: string }, Workflow | null>('automations.get', 'query'),

  /**
   * Workflows, paginated. Automations are one workflow type among several.
   */
  listWorkflows: op<{ limit?: number; start?: WorkflowCursor }, Workflow[]>('automations.listWorkflows', 'query'),

  // ----- Authoring -----

  /**
   * Propose a new automation. It starts as a draft and must be submitted and
   * approved before it can run.
   */
  createProposal: op<{
      id: string;
      name: string;
      configJson: unknown;
      metadataJson: unknown;
      eventType: string;
      automationSeriesId?: string;
    }, void>('automations.createProposal', 'mutator'),

  /**
   * Edit an automation.
   */
  update: op<{
      id: string;
      name?: string;
      configJson?: unknown;
      metadataJson?: unknown;
      eventType?: string;
    }, void>('automations.update', 'mutator'),

  /**
   * Delete an automation.
   */
  delete: op<{ id: string }, void>('automations.delete', 'mutator'),

  // ----- Approval lifecycle -----

  /**
   * Send a draft for approval.
   */
  submitForApproval: op<{ id: string }, void>('automations.submitForApproval', 'mutator'),

  /**
   * Withdraw a submission before it is decided.
   */
  revoke: op<{ id: string }, void>('automations.revoke', 'mutator'),

  /**
   * Approve a submitted automation.
   */
  approve: op<{ id: string; note?: string }, void>('automations.approve', 'mutator'),

  /**
   * Reject a submitted automation. A note explaining why is required.
   */
  reject: op<{ id: string; note: string }, void>('automations.reject', 'mutator'),

  // ----- Run state -----

  /**
   * Start running an approved automation.
   */
  activate: op<{ id: string }, void>('automations.activate', 'mutator'),

  /**
   * Stop running an automation without deleting it.
   */
  disable: op<{ id: string; cancelQueued?: boolean }, void>('automations.disable', 'mutator'),

  /**
   * Retire an automation.
   */
  archive: op<{ id: string }, void>('automations.archive', 'mutator'),
} as const;
