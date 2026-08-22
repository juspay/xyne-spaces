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

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

/** Page cursor for the workflow listing. */
export interface WorkflowCursor {
  id: string;
  createdAt: number;
}

export const automationsOperations = {
  // ----- Reads -----

  /**
   * Every automation.
   * Maps to: Zero query 'automationsList'
   */
  list: query<void, unknown[]>('automationsList'),

  /**
   * One automation.
   * Maps to: Zero query 'automationById'
   */
  get: query<{ id: string }, unknown>('automationById'),

  /**
   * Workflows, paginated. Automations are one workflow type among several.
   * Maps to: Zero query 'workflowsPaginated'
   */
  listWorkflows: query<{ limit?: number; start?: WorkflowCursor }, unknown[]>(
    'workflowsPaginated',
    {
      mapArgs: (args) => ({ limit: args?.limit ?? 50, start: args?.start ?? null }),
    }
  ),

  // ----- Authoring -----

  /**
   * Propose a new automation. It starts as a draft and must be submitted and
   * approved before it can run.
   * Maps to: Zero mutator 'automations.createProposal'
   */
  createProposal: mutator<
    {
      id: string;
      name: string;
      configJson: unknown;
      metadataJson: unknown;
      eventType: string;
      automationSeriesId?: string;
    },
    void
  >('automations.createProposal', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Edit an automation.
   * Maps to: Zero mutator 'automations.update'
   */
  update: mutator<
    {
      id: string;
      name?: string;
      configJson?: unknown;
      metadataJson?: unknown;
      eventType?: string;
    },
    void
  >('automations.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete an automation.
   * Maps to: Zero mutator 'automations.delete'
   */
  delete: mutator<{ id: string }, void>('automations.delete'),

  // ----- Approval lifecycle -----

  /**
   * Send a draft for approval.
   * Maps to: Zero mutator 'automations.submitForApproval'
   */
  submitForApproval: mutator<{ id: string }, void>('automations.submitForApproval', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Withdraw a submission before it is decided.
   * Maps to: Zero mutator 'automations.revoke'
   */
  revoke: mutator<{ id: string }, void>('automations.revoke', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Approve a submitted automation.
   * Maps to: Zero mutator 'automations.approve'
   */
  approve: mutator<{ id: string; note?: string }, void>('automations.approve', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Reject a submitted automation. A note explaining why is required.
   * Maps to: Zero mutator 'automations.reject'
   */
  reject: mutator<{ id: string; note: string }, void>('automations.reject', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Run state -----

  /**
   * Start running an approved automation.
   * Maps to: Zero mutator 'automations.activate'
   */
  activate: mutator<{ id: string }, void>('automations.activate', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Stop running an automation without deleting it.
   * Maps to: Zero mutator 'automations.disable'
   */
  disable: mutator<{ id: string; cancelQueued?: boolean }, void>('automations.disable', {
    mapArgs: (args) => ({
      id: args.id,
      timestamp: now(),
      ...(args.cancelQueued !== undefined ? { cancelQueued: args.cancelQueued } : {}),
    }),
  }),

  /**
   * Retire an automation.
   * Maps to: Zero mutator 'automations.archive'
   */
  archive: mutator<{ id: string }, void>('automations.archive', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),
} as const;
