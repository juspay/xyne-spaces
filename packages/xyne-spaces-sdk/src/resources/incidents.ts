/**
 * Incidents Resource
 *
 * Root-cause analyses, their impacts and corrective actions, and the release
 * attributions linking incidents to deploys.
 */

import { Resource } from './base.js';
import { incidentsOperations, type RcaCursor } from '../registry/incidents.js';
import { newId } from '../core/ids.js';
import type {
  ApplicationReleaseTicket,
  AttributionConfidence,
  CoeStatus,
  FormEntityValue,
  MessageAttachment,
  Rca,
  RcaStatus,
  ReleaseChange,
  ReleaseEvent,
  Severity,
  Ticket,
} from '../types/index.js';

export class IncidentsResource extends Resource {
  /**
   * List root-cause analyses, most recent first.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of RCAs.
   * @example
   * const rcas = await sdk.incidents.listRcas({ limit: 20 });
   */
  listRcas(options?: { limit?: number; start?: RcaCursor }): Promise<Rca[]> {
    return this.call(incidentsOperations.listRcas, options ?? {});
  }

  /**
   * Get one root-cause analysis.
   *
   * @param rcaId - Id of the RCA.
   * @returns The RCA, or `null` if it does not exist.
   * @example
   * const rca = await sdk.incidents.getRca('rca-1');
   */
  getRca(rcaId: string): Promise<Rca | null> {
    return this.call(incidentsOperations.getRca, { rcaId });
  }

  /**
   * Open a root-cause analysis against a ticket.
   *
   * @param data - The analysis to open.
   * @param data.ticketId - Ticket the incident is tracked on.
   * @param data.title - Short description of the incident.
   * @param data.severity - How serious it was.
   * @param data.bugTypeId - Classification of the defect.
   * @param data.categoryTypeId - Category the incident falls under.
   * @param data.status - Where the analysis starts, usually `'DRAFT'`.
   * @param data.ownerId - User accountable for completing it.
   * @param data.summary - What happened.
   * @param data.rootCause - Why it happened.
   * @param data.issueCategoryId - Finer-grained category.
   * @param data.issueStartAt - When the issue began, epoch milliseconds.
   * @returns The new RCA's id.
   * @example
   * const { id } = await sdk.incidents.createRca({
   *   ticketId: 'ticket-1',
   *   title: 'Checkout latency spike',
   *   severity: 'SEV_2',
   *   bugTypeId: 'bug-1',
   *   categoryTypeId: 'cat-1',
   *   status: 'DRAFT',
   * });
   */
  async createRca(data: {
    ticketId: string;
    title: string;
    severity: Severity;
    bugTypeId: string;
    categoryTypeId: string;
    status: RcaStatus;
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

  /**
   * Update a root-cause analysis.
   *
   * @param rcaId - Id of the RCA.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.incidents.updateRca('rca-1', { status: 'IN_REVIEW' });
   */
  updateRca(
    id: string,
    data: {
      ticketId?: string;
      title?: string;
      summary?: string;
      rootCause?: string;
      severity?: Severity;
      bugTypeId?: string;
      categoryTypeId?: string;
      issueCategoryId?: string;
      issueStartAt?: number;
      status?: RcaStatus;
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateRca, { id, ...data });
  }

  // ----- Impacts -----

  /**
   * Record an impact against an RCA.
   *
   * @param data - The impact to record.
   * @param data.ticketId - Ticket the incident is tracked on.
   * @param data.rcaId - RCA the impact belongs to.
   * @param data.impactTypeId - What kind of impact it was.
   * @param data.impact - Description of the impact.
   * @returns The new impact's id.
   * @example
   * const { id } = await sdk.incidents.createImpact({
   *   ticketId: 'ticket-1',
   *   rcaId: 'rca-1',
   *   impactTypeId: 'impact-type-1',
   *   impact: '12 minutes of failed checkouts',
   * });
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

  /**
   * Update a recorded impact.
   *
   * @param id - Id of the impact.
   * @param data.impactTypeId - New impact type.
   * @param data.impact - New description.
   * @example
   * await sdk.incidents.updateImpact('impact-1', { impact: '18 minutes' });
   */
  updateImpact(id: string, data: { impactTypeId?: string; impact?: string }): Promise<void> {
    return this.call(incidentsOperations.updateImpact, { id, ...data });
  }

  /**
   * Remove a recorded impact.
   *
   * @param id - Id of the impact.
   * @example
   * await sdk.incidents.deleteImpact('impact-1');
   */
  deleteImpact(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteImpact, { id });
  }

  /**
   * List files attached to an impact.
   *
   * @param impactId - Id of the impact.
   * @returns Its attachments.
   * @example
   * const files = await sdk.incidents.listImpactAttachments('impact-1');
   */
  listImpactAttachments(impactId: string): Promise<MessageAttachment[]> {
    return this.call(incidentsOperations.listImpactAttachments, { impactId });
  }

  /**
   * List files attached across several impacts in one call.
   *
   * @param impactIds - Impacts to read.
   * @returns Attachments for every impact named.
   * @example
   * const files = await sdk.incidents.listAttachmentsForImpacts(['impact-1']);
   */
  listAttachmentsForImpacts(impactIds: string[]): Promise<MessageAttachment[]> {
    return this.call(incidentsOperations.listAttachmentsForImpacts, { impactIds });
  }

  // ----- Corrective actions -----

  /**
   * Add a corrective action to an RCA.
   *
   * @param data - The action to add.
   * @param data.rcaId - RCA the action belongs to.
   * @param data.ownerId - User accountable for it.
   * @param data.actionTypeId - What kind of action it is.
   * @param data.action - What will be done.
   * @param data.status - Where it starts, usually `'OPEN'`.
   * @param data.dueDate - When it is due, epoch milliseconds.
   * @returns The new action's id.
   * @example
   * const { id } = await sdk.incidents.createAction({
   *   rcaId: 'rca-1',
   *   ownerId: 'user-1',
   *   actionTypeId: 'action-type-1',
   *   action: 'Add a latency alert',
   *   status: 'OPEN',
   * });
   */
  async createAction(data: {
    rcaId: string;
    ownerId: string;
    actionTypeId: string;
    action: string;
    status: CoeStatus;
    dueDate?: number;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createAction, { id, ...data });
    return { id };
  }

  /**
   * Update a corrective action.
   *
   * @param id - Id of the action.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.incidents.updateAction('action-1', { status: 'COMPLETED' });
   */
  updateAction(
    id: string,
    data: {
      ownerId?: string;
      actionTypeId?: string;
      action?: string;
      status?: CoeStatus;
      dueDate?: number;
      completedAt?: number;
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateAction, { id, ...data });
  }

  /**
   * Remove a corrective action.
   *
   * @param id - Id of the action.
   * @example
   * await sdk.incidents.deleteAction('action-1');
   */
  deleteAction(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteAction, { id });
  }

  // ----- Releases -----

  /**
   * List every release ticket in the workspace.
   *
   * @returns Tickets of type `Release`.
   * @example
   * const releases = await sdk.incidents.listReleaseTickets();
   */
  listReleaseTickets(): Promise<Ticket[]> {
    return this.call(incidentsOperations.listReleaseTickets, undefined);
  }

  /**
   * Search release tickets by name.
   *
   * @param options.search - Text to match.
   * @param options.limit - Maximum results.
   * @returns Matching release tickets.
   * @example
   * const releases = await sdk.incidents.searchReleaseTickets({ search: '2026.09' });
   */
  searchReleaseTickets(options?: { search?: string; limit?: number }): Promise<Ticket[]> {
    return this.call(incidentsOperations.searchReleaseTickets, options ?? {});
  }

  /**
   * List the dev tickets included in a release, with their test outcomes.
   *
   * @param releaseId - Release to read.
   * @param limit - Maximum rows to return.
   * @returns One row per ticket in the release.
   * @example
   * const tickets = await sdk.incidents.listApplicationReleaseTickets('release-1');
   */
  listApplicationReleaseTickets(releaseId: string, limit?: number): Promise<ApplicationReleaseTicket[]> {
    return this.call(incidentsOperations.listApplicationReleaseTickets, {
      releaseId,
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  /**
   * List the code changes bundled into a release.
   *
   * @param releaseId - Release to read.
   * @returns Changes attributed to it, from the repository scan.
   * @example
   * const changes = await sdk.incidents.listReleaseChanges('release-1');
   */
  listReleaseChanges(releaseId: string): Promise<ReleaseChange[]> {
    return this.call(incidentsOperations.listReleaseChanges, { releaseId });
  }

  /**
   * List form values captured against a release's changes.
   *
   * @param releaseId - Release to read.
   * @returns The recorded field values.
   * @example
   * const values = await sdk.incidents.listReleaseChangeFormValues('release-1');
   */
  listReleaseChangeFormValues(releaseId: string): Promise<FormEntityValue[]> {
    return this.call(incidentsOperations.listReleaseChangeFormValues, { releaseId });
  }

  /**
   * List change-log entries for a release.
   *
   * @param releaseId - Release to read.
   * @returns The recorded change-log values.
   * @example
   * const log = await sdk.incidents.listReleaseChangeLog('release-1');
   */
  listReleaseChangeLog(releaseId: string): Promise<FormEntityValue[]> {
    return this.call(incidentsOperations.listReleaseChangeLog, { releaseId });
  }

  /**
   * Attribute a ticket to the release that caused it.
   *
   * @param data - The attribution to record.
   * @param data.ticketId - Ticket being attributed.
   * @param data.releaseId - Release held responsible.
   * @param data.confidence - How certain the attribution is.
   * @param data.releaseApplicationId - Which application within the release.
   * @param data.rootCauseTicketId - The change that introduced the fault.
   * @returns The new attribution's id.
   * @example
   * const { id } = await sdk.incidents.createAttribution({
   *   ticketId: 'ticket-1',
   *   releaseId: 'release-1',
   *   confidence: 'HIGH',
   * });
   */
  async createAttribution(data: {
    ticketId: string;
    releaseId: string;
    confidence: AttributionConfidence;
    releaseApplicationId?: string;
    rootCauseTicketId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(incidentsOperations.createAttribution, { id, ...data });
    return { id };
  }

  /**
   * Update a release attribution.
   *
   * @param id - Id of the attribution.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.incidents.updateAttribution('attribution-1', { confidence: 'MEDIUM' });
   */
  updateAttribution(
    id: string,
    data: {
      releaseId?: string;
      releaseApplicationId?: string;
      rootCauseTicketId?: string;
      confidence?: AttributionConfidence;
    }
  ): Promise<void> {
    return this.call(incidentsOperations.updateAttribution, { id, ...data });
  }

  /**
   * Remove a release attribution.
   *
   * @param id - Id of the attribution.
   * @example
   * await sdk.incidents.deleteAttribution('attribution-1');
   */
  deleteAttribution(id: string): Promise<void> {
    return this.call(incidentsOperations.deleteAttribution, { id });
  }

  /**
   * Move a ticket within a release to another stage.
   *
   * @param id - Id of the application-release-ticket row.
   * @param data.stageName - Stage to move it to.
   * @param data.defaultTicketStatusV2 - Status to set alongside the stage.
   * @param data.failureReason - Why testing failed, when it did.
   * @example
   * await sdk.incidents.updateReleaseTicketStatus('art-1', { stageName: 'Tested' });
   */
  updateReleaseTicketStatus(
    id: string,
    data: { stageName?: string; defaultTicketStatusV2?: string; failureReason?: string }
  ): Promise<void> {
    return this.call(incidentsOperations.updateReleaseTicketStatus, { id, ...data });
  }

  /**
   * Record who signed a release ticket off in testing.
   *
   * @param id - Id of the application-release-ticket row.
   * @param userId - User who tested it.
   * @example
   * await sdk.incidents.setReleaseTicketTestedBy('art-1', 'user-1');
   */
  setReleaseTicketTestedBy(id: string, userId: string): Promise<void> {
    return this.call(incidentsOperations.setReleaseTicketTestedBy, { id, userId });
  }
  /**
   * A release's event log, newest first. `FORM_SAVED` events are omitted as noise.
   *
   * @param releaseId - Release to read.
   * @param limit - Maximum events. Capped at 100 server-side.
   * @returns The release's timeline.
   * @example
   * const events = await sdk.incidents.listReleaseEvents('release-1', 50);
   */
  listReleaseEvents(releaseId: string, limit?: number): Promise<ReleaseEvent[]> {
    return this.call(incidentsOperations.listReleaseEvents, {
      releaseId,
      ...(limit !== undefined ? { limit } : {}),
    });
  }
}
