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

export class AutomationsResource extends Resource {
  /** List every automation. */
  list(): Promise<unknown[]> {
    return this.call(automationsOperations.list, undefined);
  }

  /** Get one automation. */
  get(id: string): Promise<unknown> {
    return this.call(automationsOperations.get, { id });
  }

  /** List workflows. Automations are one workflow type among several. */
  listWorkflows(options?: { limit?: number; start?: WorkflowCursor }): Promise<unknown[]> {
    return this.call(automationsOperations.listWorkflows, options ?? {});
  }

  /**
   * Propose a new automation.
   *
   * It starts as a draft — submit it for approval, get it approved, then
   * activate it before it will run.
   *
   * @returns The new automation id
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

  /** Edit an automation. */
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

  /** Delete an automation. */
  delete(id: string): Promise<void> {
    return this.call(automationsOperations.delete, { id });
  }

  /** Send a draft for approval. */
  submitForApproval(id: string): Promise<void> {
    return this.call(automationsOperations.submitForApproval, { id });
  }

  /** Withdraw a submission before it is decided. */
  revoke(id: string): Promise<void> {
    return this.call(automationsOperations.revoke, { id });
  }

  /** Approve a submitted automation. */
  approve(id: string, options?: { note?: string }): Promise<void> {
    return this.call(automationsOperations.approve, { id, ...options });
  }

  /**
   * Reject a submitted automation.
   *
   * @param note - Why it was rejected. Required.
   */
  reject(id: string, note: string): Promise<void> {
    return this.call(automationsOperations.reject, { id, note });
  }

  /** Start running an approved automation. */
  activate(id: string): Promise<void> {
    return this.call(automationsOperations.activate, { id });
  }

  /** Stop running an automation without deleting it. */
  disable(id: string): Promise<void> {
    return this.call(automationsOperations.disable, { id });
  }

  /** Retire an automation. */
  archive(id: string): Promise<void> {
    return this.call(automationsOperations.archive, { id });
  }
}
