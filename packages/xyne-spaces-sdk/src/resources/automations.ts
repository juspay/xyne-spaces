/**
 * Automations Resource
 *
 * Event-triggered automations and their approval lifecycle.
 *
 * The sequence is: `createProposal` → `submitForApproval` → `approve` →
 * `activate`. An automation does not run until it has been through it.
 */

import { Resource } from './base.js';
import { automationsOperations, type WorkflowCursor } from '../registry/automations.js';
import { newId } from '../core/ids.js';
import type { Workflow } from '../types/index.js';

export class AutomationsResource extends Resource {
  /**
   * List every automation in the workspace.
   *
   * @returns All automations, whatever stage of the lifecycle they are in.
   * @example
   * const automations = await sdk.automations.list();
   */
  list(): Promise<Workflow[]> {
    return this.call(automationsOperations.list, undefined);
  }

  /**
   * Get one automation.
   *
   * @param id - Id of the automation.
   * @returns The automation, or `null` if it does not exist.
   * @example
   * const automation = await sdk.automations.get('automation-1');
   */
  get(id: string): Promise<Workflow | null> {
    return this.call(automationsOperations.get, { id });
  }

  /**
   * List workflow runs. Automations are one workflow type among several.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of runs, newest first.
   * @example
   * const runs = await sdk.automations.listWorkflows({ limit: 20 });
   */
  listWorkflows(options?: { limit?: number; start?: WorkflowCursor }): Promise<Workflow[]> {
    return this.call(automationsOperations.listWorkflows, options ?? {});
  }

  /**
   * Propose a new automation.
   *
   * It starts as a draft — submit it for approval, get it approved, then
   * activate it before it will run.
   *
   * @param data - The automation to propose.
   * @param data.name - Display name.
   * @param data.configJson - What the automation does, as JSON.
   * @param data.metadataJson - Descriptive metadata, as JSON.
   * @param data.eventType - The event that triggers it.
   * @param data.automationSeriesId - Recurring series this belongs to.
   * @returns The new automation's id.
   * @example
   * const { id } = await sdk.automations.createProposal({
   *   name: 'Auto-triage',
   *   configJson: {},
   *   metadataJson: {},
   *   eventType: 'TICKET_CREATED',
   * });
   */
  async createProposal(data: {
    name: string;
    configJson: unknown;
    metadataJson: unknown;
    eventType: string;
    automationSeriesId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(automationsOperations.createProposal, { id, ...data });
    return { id };
  }

  /**
   * Edit an automation.
   *
   * @param id - Id of the automation.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.name - New display name.
   * @param data.configJson - New definition, as JSON.
   * @param data.metadataJson - New metadata, as JSON.
   * @param data.eventType - New trigger event.
   * @example
   * await sdk.automations.update('automation-1', { name: 'Auto-triage v2' });
   */
  update(
    id: string,
    data: {
      name?: string;
      configJson?: unknown;
      metadataJson?: unknown;
      eventType?: string;
    }
  ): Promise<void> {
    return this.call(automationsOperations.update, { id, ...data });
  }

  /**
   * Delete an automation.
   *
   * @param id - Id of the automation.
   * @example
   * await sdk.automations.delete('automation-1');
   */
  delete(id: string): Promise<void> {
    return this.call(automationsOperations.delete, { id });
  }

  /**
   * Send a draft automation for approval.
   *
   * @param id - Id of the automation.
   * @example
   * await sdk.automations.submitForApproval('automation-1');
   */
  submitForApproval(id: string): Promise<void> {
    return this.call(automationsOperations.submitForApproval, { id });
  }

  /**
   * Withdraw a submission before it is approved or rejected.
   *
   * @param id - Id of the automation.
   * @example
   * await sdk.automations.revoke('automation-1');
   */
  revoke(id: string): Promise<void> {
    return this.call(automationsOperations.revoke, { id });
  }

  /**
   * Approve a submitted automation. It still needs activating before it runs.
   *
   * @param id - Id of the automation.
   * @param options.note - Optional note recorded with the approval.
   * @example
   * await sdk.automations.approve('automation-1', { note: 'Looks safe' });
   */
  approve(id: string, options?: { note?: string }): Promise<void> {
    return this.call(automationsOperations.approve, { id, ...options });
  }

  /**
   * Reject a submitted automation.
   *
   * @param id - Id of the automation.
   * @param note - Why it was rejected. Required.
   * @example
   * await sdk.automations.reject('automation-1', 'Too broad a trigger');
   */
  reject(id: string, note: string): Promise<void> {
    return this.call(automationsOperations.reject, { id, note });
  }

  /**
   * Start running an approved automation.
   *
   * @param id - Id of the automation.
   * @example
   * await sdk.automations.activate('automation-1');
   */
  activate(id: string): Promise<void> {
    return this.call(automationsOperations.activate, { id });
  }

  /**
   * Stop running an automation without deleting it.
   *
   * @param id - Id of the automation.
   * @param cancelQueued - Also cancel runs already scheduled. Defaults to leaving them.
   * @example
   * await sdk.automations.disable('automation-1', true);
   */
  disable(id: string, cancelQueued?: boolean): Promise<void> {
    return this.call(automationsOperations.disable, {
      id,
      ...(cancelQueued !== undefined ? { cancelQueued } : {}),
    });
  }

  /**
   * Retire an automation, keeping its history.
   *
   * @param id - Id of the automation.
   * @example
   * await sdk.automations.archive('automation-1');
   */
  archive(id: string): Promise<void> {
    return this.call(automationsOperations.archive, { id });
  }
}
