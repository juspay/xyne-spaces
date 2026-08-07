/**
 * Forms Resource
 *
 * Custom forms, where they apply, and the values submitted against them.
 */

import { Resource } from './base.js';
import { formsOperations, type FormFieldInput } from '../registry/forms.js';
import { newId } from '../core/ids.js';
import type { Form, FormEntityValue, FormField } from '../types/index.js';

export class FormsResource extends Resource {
  /**
   * List every form with its fields and context mappings.
   *
   * @example
   * const forms = await sdk.forms.list();
   */
  list(): Promise<Form[]> {
    return this.call(formsOperations.list, undefined);
  }

  /** List forms without their relations. */
  listLite(): Promise<Form[]> {
    return this.call(formsOperations.listLite, undefined);
  }

  /** List forms bound to a kind of context. */
  listByContextType(contextType: string): Promise<Form[]> {
    return this.call(formsOperations.listByContextType, { contextType });
  }

  /** List a form's fields, in sequence order. */
  listFields(formId: string): Promise<FormField[]> {
    return this.call(formsOperations.listFields, { formId });
  }

  /** Find which form applies in a particular context. */
  getMapping(
    contextId: string,
    contextType: string,
    entityType: string
  ): Promise<unknown> {
    return this.call(formsOperations.getMapping, { contextId, contextType, entityType });
  }

  /** List form mappings across several boards. */
  listMappingsForBoards(boardIds: string[]): Promise<unknown[]> {
    return this.call(formsOperations.listMappingsForBoards, { boardIds });
  }

  /**
   * List the values submitted for one entity.
   *
   * @example
   * const values = await sdk.forms.listValues('ticket-123');
   */
  listValues(entityId: string): Promise<FormEntityValue[]> {
    return this.call(formsOperations.listValues, { entityId });
  }

  /** List every ticket form value in the workspace. */
  listAllTicketValues(): Promise<FormEntityValue[]> {
    return this.call(formsOperations.listAllTicketValues, undefined);
  }

  /**
   * Create or update a form and its fields.
   *
   * `fields` replaces the entire field list. Send every field you want to keep,
   * each with its existing `id` — any field you omit is removed. Read the
   * current set with `listFields` first.
   *
   * Omit `formId` to create a new form.
   *
   * @returns The form id
   */
  async update(data: {
    formId?: string;
    fields: FormFieldInput[];
    projectId?: string;
    formDescription?: string;
  }): Promise<{ formId: string }> {
    const formId = data.formId ?? newId();
    await this.call(formsOperations.update, { ...data, formId });
    return { formId };
  }

  /**
   * Bind a form to a context, so it applies there.
   *
   * @returns The mapping id
   */
  async setMapping(data: {
    contextId: string;
    contextType: string;
    entityType: string;
    formId: string;
  }): Promise<{ mappingId: string }> {
    const mappingId = newId();
    await this.call(formsOperations.setMapping, { mappingId, ...data });
    return { mappingId };
  }

  /** Unbind a form from a context. */
  deleteMapping(
    contextId: string,
    contextType: string,
    entityType: string
  ): Promise<void> {
    return this.call(formsOperations.deleteMapping, {
      contextId,
      contextType,
      entityType,
    });
  }

  /**
   * Record a value for a form field on an entity.
   *
   * @returns The id of the new value row
   */
  async createValue(data: {
    entityId: string;
    entityType: string;
    formId: string;
    fieldId: string;
    newValue: unknown;
    contextId?: string;
    version?: number;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(formsOperations.createValue, { id, ...data });
    return { id };
  }

  /**
   * Change a recorded value.
   *
   * @param options.expectedValueUpdatedAt - The `updatedAt` you last read. When
   * supplied, the write is rejected if the value changed in the meantime.
   */
  updateValue(
    formEntityValueId: string,
    newValue: unknown,
    options?: { expectedValueUpdatedAt?: number }
  ): Promise<void> {
    return this.call(formsOperations.updateValue, {
      formEntityValueId,
      newValue,
      ...options,
    });
  }
}
