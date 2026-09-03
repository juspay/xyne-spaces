/**
 * Incidents Operation Registry
 *
 * Root-cause analyses and everything attached to them: recorded impacts,
 * corrective actions (CoE), and the release attributions that connect an
 * incident to the deploy that caused it.
 *
 * An RCA hangs off a ticket. Impacts and CoE items hang off the RCA.
 */

import { op } from './types.js';

/** Page cursor for the RCA listing. */
export interface RcaCursor {
  id: string;
  createdAt: number;
}

export const incidentsOperations = {
  // ----- Reads -----

  /**
   * Every RCA, most recent first.
   */
  listRcas: op<{ limit?: number; start?: RcaCursor }, unknown[]>('incidents.listRcas', 'query'),

  /**
   * One RCA.
   */
  getRca: op<{ rcaId: string }, unknown>('incidents.getRca', 'query'),

  /**
   * Impacts recorded against an RCA.
   */
  listImpactAttachments: op<{ impactId: string }, unknown[]>('incidents.listImpactAttachments', 'query'),

  /**
   * Attachments across several impacts.
   */
  listAttachmentsForImpacts: op<{ impactIds: string[] }, unknown[]>('incidents.listAttachmentsForImpacts', 'query'),

  /**
   * Release tickets.
   */
  listReleaseTickets: op<void, unknown[]>('incidents.listReleaseTickets', 'query'),

  /**
   * Search release tickets.
   */
  searchReleaseTickets: op<{ search?: string; limit?: number }, unknown[]>('incidents.searchReleaseTickets', 'query'),

  /**
   * Application release tickets for a release.
   */
  listApplicationReleaseTickets: op<{ releaseId: string; limit?: number }, unknown[]>('incidents.listApplicationReleaseTickets', 'query'),

  /**
   * Changes bundled into a release.
   */
  listReleaseChanges: op<{ releaseId: string }, unknown[]>('incidents.listReleaseChanges', 'query'),

  /**
   * Form values captured against a release's changes.
   */
  listReleaseChangeFormValues: op<{ releaseId: string }, unknown[]>('incidents.listReleaseChangeFormValues', 'query'),

  /**
   * Change-log entries for a release.
   */
  listReleaseChangeLog: op<{ releaseId: string }, unknown[]>('incidents.listReleaseChangeLog', 'query'),

  // ----- RCA -----

  /**
   * Open an RCA against a ticket.
   */
  createRca: op<{
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
    }, void>('incidents.createRca', 'mutator'),

  /**
   * Update an RCA.
   */
  updateRca: op<{
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
    }, void>('incidents.updateRca', 'mutator'),

  // ----- Impacts -----

  /**
   * Record an impact against an RCA.
   */
  createImpact: op<{ id: string; ticketId: string; rcaId: string; impactTypeId: string; impact: string }, void>('incidents.createImpact', 'mutator'),

  /**
   * Update a recorded impact.
   */
  updateImpact: op<{ id: string; impactTypeId?: string; impact?: string }, void>('incidents.updateImpact', 'mutator'),

  /**
   * Remove a recorded impact.
   */
  deleteImpact: op<{ id: string }, void>('incidents.deleteImpact', 'mutator'),

  // ----- Corrective actions -----

  /**
   * Add a corrective action to an RCA.
   */
  createAction: op<{
      id: string;
      rcaId: string;
      ownerId: string;
      actionTypeId: string;
      action: string;
      status: string;
      dueDate?: number;
    }, void>('incidents.createAction', 'mutator'),

  /**
   * Update a corrective action.
   */
  updateAction: op<{
      id: string;
      ownerId?: string;
      actionTypeId?: string;
      action?: string;
      status?: string;
      dueDate?: number;
      completedAt?: number;
    }, void>('incidents.updateAction', 'mutator'),

  /**
   * Remove a corrective action.
   */
  deleteAction: op<{ id: string }, void>('incidents.deleteAction', 'mutator'),

  // ----- Release attribution -----

  /**
   * Attribute a ticket to a release.
   */
  createAttribution: op<{
      id: string;
      ticketId: string;
      releaseId: string;
      confidence: number;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
    }, void>('incidents.createAttribution', 'mutator'),

  /**
   * Update an attribution.
   */
  updateAttribution: op<{
      id: string;
      releaseId?: string;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
      confidence?: number;
    }, void>('incidents.updateAttribution', 'mutator'),

  /**
   * Remove an attribution.
   */
  deleteAttribution: op<{ id: string }, void>('incidents.deleteAttribution', 'mutator'),

  /**
   * Move an application release ticket to another stage.
   */
  updateReleaseTicketStatus: op<{
      id: string;
      stageName?: string;
      defaultTicketStatusV2?: string;
      failureReason?: string;
    }, void>('incidents.updateReleaseTicketStatus', 'mutator'),

  /**
   * Record who tested a release ticket.
   */
  setReleaseTicketTestedBy: op<{ id: string; userId: string }, void>('incidents.setReleaseTicketTestedBy', 'mutator'),

  /**
   * A release's event log, newest first. `FORM_SAVED` events are filtered out
   * server-side as noise.
   */
  listReleaseEvents: op<{ releaseId: string; limit?: number }, unknown[]>('incidents.listReleaseEvents', 'query'),
} as const;
