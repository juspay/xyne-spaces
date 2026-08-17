/**
 * Incidents Operation Registry
 *
 * Root-cause analyses and everything attached to them: recorded impacts,
 * corrective actions (CoE), and the release attributions that connect an
 * incident to the deploy that caused it.
 *
 * An RCA hangs off a ticket. Impacts and CoE items hang off the RCA.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

/** Page cursor for the RCA listing. */
export interface RcaCursor {
  id: string;
  createdAt: number;
}

export const incidentsOperations = {
  // ----- Reads -----

  /**
   * Every RCA, most recent first.
   * Maps to: Zero query 'allRCAsPaginated'
   */
  listRcas: query<{ limit?: number; start?: RcaCursor }, unknown[]>('allRCAsPaginated', {
    mapArgs: (args) => ({ limit: args?.limit ?? 50, start: args?.start ?? null }),
  }),

  /**
   * One RCA.
   * Maps to: Zero query 'rcaById'
   */
  getRca: query<{ rcaId: string }, unknown>('rcaById'),

  /**
   * Impacts recorded against an RCA.
   * Maps to: Zero query 'attachmentsByImpact'
   */
  listImpactAttachments: query<{ impactId: string }, unknown[]>('attachmentsByImpact'),

  /**
   * Attachments across several impacts.
   * Maps to: Zero query 'attachmentsByImpactIds'
   */
  listAttachmentsForImpacts: query<{ impactIds: string[] }, unknown[]>(
    'attachmentsByImpactIds'
  ),

  /**
   * Release tickets.
   * Maps to: Zero query 'releaseTickets'
   */
  listReleaseTickets: query<void, unknown[]>('releaseTickets'),

  /**
   * Search release tickets.
   * Maps to: Zero query 'releaseTicketsSearch'
   */
  searchReleaseTickets: query<{ search?: string; limit?: number }, unknown[]>(
    'releaseTicketsSearch'
  ),

  /**
   * Application release tickets for a release.
   * Maps to: Zero query 'applicationReleaseTicketsByReleaseId'
   */
  listApplicationReleaseTickets: query<
    { releaseId: string; limit?: number },
    unknown[]
  >('applicationReleaseTicketsByReleaseId', {
    // releaseId is required; the old `void` signature sent nothing at all.
    mapArgs: (args) => ({
      releaseId: args.releaseId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),
  }),

  /**
   * Changes bundled into a release.
   * Maps to: Zero query 'releaseChangesByReleaseId'
   */
  listReleaseChanges: query<{ releaseId: string }, unknown[]>('releaseChangesByReleaseId'),

  /**
   * Form values captured against a release's changes.
   * Maps to: Zero query 'releaseChangeFormValuesByReleaseId'
   */
  listReleaseChangeFormValues: query<{ releaseId: string }, unknown[]>(
    'releaseChangeFormValuesByReleaseId'
  ),

  /**
   * Change-log entries for a release.
   * Maps to: Zero query 'releaseChangeLogValuesByReleaseId'
   */
  listReleaseChangeLog: query<{ releaseId: string }, unknown[]>(
    'releaseChangeLogValuesByReleaseId'
  ),

  // ----- RCA -----

  /**
   * Open an RCA against a ticket.
   * Maps to: Zero mutator 'rca.create'
   */
  createRca: mutator<
    {
      id: string;
      ticketId: string;
      title: string;
      severity: string;
      bugTypeId: string;
      categoryTypeId: string;
      status: string;
      ownerId?: string;
      summary?: string;
      rootCause?: string;
      issueCategoryId?: string;
      issueStartAt?: number;
    },
    void
  >('rca.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Update an RCA.
   * Maps to: Zero mutator 'rca.update'
   */
  updateRca: mutator<
    {
      id: string;
      ticketId?: string;
      title?: string;
      summary?: string;
      rootCause?: string;
      severity?: string;
      bugTypeId?: string;
      categoryTypeId?: string;
      issueCategoryId?: string;
      issueStartAt?: number;
      status?: string;
    },
    void
  >('rca.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Impacts -----

  /**
   * Record an impact against an RCA.
   * Maps to: Zero mutator 'impact.create'
   */
  createImpact: mutator<
    { id: string; ticketId: string; rcaId: string; impactTypeId: string; impact: string },
    void
  >('impact.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Update a recorded impact.
   * Maps to: Zero mutator 'impact.update'
   */
  updateImpact: mutator<{ id: string; impactTypeId?: string; impact?: string }, void>(
    'impact.update'
  ),

  /**
   * Remove a recorded impact.
   * Maps to: Zero mutator 'impact.delete'
   */
  deleteImpact: mutator<{ id: string }, void>('impact.delete'),

  // ----- Corrective actions -----

  /**
   * Add a corrective action to an RCA.
   * Maps to: Zero mutator 'coe.create'
   */
  createAction: mutator<
    {
      id: string;
      rcaId: string;
      ownerId: string;
      actionTypeId: string;
      action: string;
      status: string;
      dueDate?: number;
    },
    void
  >('coe.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Update a corrective action.
   * Maps to: Zero mutator 'coe.update'
   */
  updateAction: mutator<
    {
      id: string;
      ownerId?: string;
      actionTypeId?: string;
      action?: string;
      status?: string;
      dueDate?: number;
      completedAt?: number;
    },
    void
  >('coe.update'),

  /**
   * Remove a corrective action.
   * Maps to: Zero mutator 'coe.delete'
   */
  deleteAction: mutator<{ id: string }, void>('coe.delete'),

  // ----- Release attribution -----

  /**
   * Attribute a ticket to a release.
   * Maps to: Zero mutator 'releaseAttribution.create'
   */
  createAttribution: mutator<
    {
      id: string;
      ticketId: string;
      releaseId: string;
      confidence: number;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
    },
    void
  >('releaseAttribution.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Update an attribution.
   * Maps to: Zero mutator 'releaseAttribution.update'
   */
  updateAttribution: mutator<
    {
      id: string;
      releaseId?: string;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
      confidence?: number;
    },
    void
  >('releaseAttribution.update'),

  /**
   * Remove an attribution.
   * Maps to: Zero mutator 'releaseAttribution.delete'
   */
  deleteAttribution: mutator<{ id: string }, void>('releaseAttribution.delete'),

  /**
   * Move an application release ticket to another stage.
   * Maps to: Zero mutator 'applicationReleaseTicket.updateStatus'
   */
  updateReleaseTicketStatus: mutator<
    {
      id: string;
      stageName?: string;
      defaultTicketStatusV2?: string;
      failureReason?: string;
    },
    void
  >('applicationReleaseTicket.updateStatus', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Record who tested a release ticket.
   * Maps to: Zero mutator 'applicationReleaseTicket.setTestedBy'
   */
  setReleaseTicketTestedBy: mutator<{ id: string; userId: string }, void>(
    'applicationReleaseTicket.setTestedBy',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * A release's event log, newest first. `FORM_SAVED` events are filtered out
   * server-side as noise.
   * Maps to: Zero query 'releaseEventsByReleaseId'
   */
  listReleaseEvents: query<{ releaseId: string; limit?: number }, unknown[]>(
    'releaseEventsByReleaseId',
    {
      // limit is required and capped at 100 server-side.
      mapArgs: (args) => ({
        releaseId: args.releaseId,
        limit: Math.min(args.limit ?? 50, 100),
      }),
    }
  ),
} as const;
