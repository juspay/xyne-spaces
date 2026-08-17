/**
 * Incidents Resource
 *
 * Root-cause analyses, their impacts and corrective actions, and the release
 * attributions linking incidents to deploys.
 */

import { Resource } from './base.js';
import { incidentsOperations, type RcaCursor } from '../registry/incidents.js';
import { newId } from '../core/ids.js';

export class IncidentsResource extends Resource {
  /** List RCAs, most recent first. */
  listRcas(options?: { limit?: number; start?: RcaCursor }): Promise<unknown[]> {
    return this.call(incidentsOperations.listRcas, options ?? {});
  }

  /** Get one RCA. */
  getRca(rcaId: string): Promise<unknown> {
    return this.call(incidentsOperations.getRca, { rcaId });
  }

  /**
   * Open an RCA against a ticket.
   *
   * @returns The new RCA id
   */
  async createRca(data: {
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
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createRca, { id, ...data });
    return { id };
  }

  /** Update an RCA. */
  updateRca(
    id: string,
    data: {
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
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateRca, { id, ...data });
  }

  // ----- Impacts -----

  /**
   * Record an impact against an RCA.
   *
   * @returns The new impact id
   */
  async createImpact(data: {
    ticketId: string;
    rcaId: string;
    impactTypeId: string;
    impact: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createImpact, { id, ...data });
    return { id };
  }

  /** Update a recorded impact. */
  updateImpact(id: string, data: { impactTypeId?: string; impact?: string }): Promise<void> {
    return this.call(incidentsOperations.updateImpact, { id, ...data });
  }

  /** Remove a recorded impact. */
  deleteImpact(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteImpact, { id });
  }

  /** List attachments on an impact. */
  listImpactAttachments(impactId: string): Promise<unknown[]> {
    return this.call(incidentsOperations.listImpactAttachments, { impactId });
  }

  /** List attachments across several impacts. */
  listAttachmentsForImpacts(impactIds: string[]): Promise<unknown[]> {
    return this.call(incidentsOperations.listAttachmentsForImpacts, { impactIds });
  }

  // ----- Corrective actions -----

  /**
   * Add a corrective action to an RCA.
   *
   * @returns The new action id
   */
  async createAction(data: {
    rcaId: string;
    ownerId: string;
    actionTypeId: string;
    action: string;
    status: string;
    dueDate?: number;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createAction, { id, ...data });
    return { id };
  }

  /** Update a corrective action. */
  updateAction(
    id: string,
    data: {
      ownerId?: string;
      actionTypeId?: string;
      action?: string;
      status?: string;
      dueDate?: number;
      completedAt?: number;
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateAction, { id, ...data });
  }

  /** Remove a corrective action. */
  deleteAction(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteAction, { id });
  }

  // ----- Releases -----

  /** List release tickets. */
  listReleaseTickets(): Promise<unknown[]> {
    return this.call(incidentsOperations.listReleaseTickets, undefined);
  }

  /** Search release tickets. */
  searchReleaseTickets(options?: { search?: string; limit?: number }): Promise<unknown[]> {
    return this.call(incidentsOperations.searchReleaseTickets, options ?? {});
  }

  /** List application release tickets. */
  listApplicationReleaseTickets(releaseId: string, limit?: number): Promise<unknown[]> {
    return this.call(incidentsOperations.listApplicationReleaseTickets, {
      releaseId,
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  /** List the changes bundled into a release. */
  listReleaseChanges(releaseId: string): Promise<unknown[]> {
    return this.call(incidentsOperations.listReleaseChanges, { releaseId });
  }

  /** List form values captured against a release's changes. */
  listReleaseChangeFormValues(releaseId: string): Promise<unknown[]> {
    return this.call(incidentsOperations.listReleaseChangeFormValues, { releaseId });
  }

  /** List change-log entries for a release. */
  listReleaseChangeLog(releaseId: string): Promise<unknown[]> {
    return this.call(incidentsOperations.listReleaseChangeLog, { releaseId });
  }

  /**
   * Attribute a ticket to a release.
   *
   * @param data.confidence - How certain the attribution is
   * @returns The new attribution id
   */
  async createAttribution(data: {
    ticketId: string;
    releaseId: string;
    confidence: number;
    releaseApplicationId?: string;
    rootCauseTicketId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createAttribution, { id, ...data });
    return { id };
  }

  /** Update an attribution. */
  updateAttribution(
    id: string,
    data: {
      releaseId?: string;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
      confidence?: number;
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateAttribution, { id, ...data });
  }

  /** Remove an attribution. */
  deleteAttribution(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteAttribution, { id });
  }

  /** Move an application release ticket to another stage. */
  updateReleaseTicketStatus(
    id: string,
    data: { stageName?: string; defaultTicketStatusV2?: string; failureReason?: string }
  ): Promise<void> {
    return this.call(incidentsOperations.updateReleaseTicketStatus, { id, ...data });
  }

  /** Record who tested a release ticket. */
  setReleaseTicketTestedBy(id: string, userId: string): Promise<void> {
    return this.call(incidentsOperations.setReleaseTicketTestedBy, { id, userId });
  }
  /**
   * A release's event log, newest first. `FORM_SAVED` events are omitted as noise.
   *
   * @param limit - Capped at 100 server-side
   */
  listReleaseEvents(releaseId: string, limit?: number): Promise<unknown[]> {
    return this.call(incidentsOperations.listReleaseEvents, {
      releaseId,
      ...(limit !== undefined ? { limit } : {}),
    });
  }
}
