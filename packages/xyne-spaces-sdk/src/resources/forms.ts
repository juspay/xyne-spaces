/**
 * Forms Resource
 *
 * Custom forms, where they apply, and the values submitted against them.
 */

import { Resource } from './base.js';
import { formsOperations, type FormFieldInput } from '../registry/forms.js';
import { newId } from '../core/ids.js';
import type {
  Form,
  FormContextMapping,
  FormContextType,
  FormEntityType,
  FormEntityValue,
  FormField,
} from '../types/index.js';

export class FormsResource extends Resource {
  /**
   * Get one form by id, without its fields.
   *
   * Fields come separately from {@link listFields}; this returns the form row alone.
   *
   * @param formId - Id of the form.
   * @returns The form, or `null` if it does not exist.
   * @example
   * const form = await sdk.forms.get('form-1');
   */
  get(formId: string): Promise<Form | null> {
    return this.call(formsOperations.get, { formId });
  }

  /**
   * List every form with its fields and context mappings resolved.
   *
   * @returns All forms, each with its fields and where it applies.
   * @example
   * const forms = await sdk.forms.list();
   */
  list(): Promise<Form[]> {
    return this.call(formsOperations.list, undefined);
  }

  /**
   * List forms without their fields or mappings.
   *
   * Cheaper than {@link list}; use it to populate a picker.
   *
   * @returns All forms, identifying fields only.
   * @example
   * const options = await sdk.forms.listLite();
   */
  listLite(): Promise<Form[]> {
    return this.call(formsOperations.listLite, undefined);
  }

  /**
   * Form-to-context mappings for several contexts at once, with their fields.
   *
   * @param contextIds - Boards, stages or release changes to look up.
   * @param contextType - Which kind of context those ids are.
   * @param entityType - Which record type the form applies to.
   * @returns One mapping per context that has a form bound.
   * @example
   * const mappings = await sdk.forms.listMappingsByContextIds(
   *   ['board-1'], 'BOARD', 'TICKET',
   * );
   */
  listMappingsByContextIds(
    contextIds: string[],
    contextType: FormContextType,
    entityType: FormEntityType
  ): Promise<FormContextMapping[]> {
    return this.call(formsOperations.listMappingsByContextIds, {
      contextIds,
      contextType,
      entityType,
    });
  }

  /**
   * List forms bound to a kind of context.
   *
   * @param contextType - Which kind of context to look at.
   * @returns Forms bound anywhere in that context type.
   * @example
   * const forms = await sdk.forms.listByContextType('BOARD');
   */
  listByContextType(contextType: FormContextType): Promise<Form[]> {
    return this.call(formsOperations.listByContextType, { contextType });
  }

  /**
   * List a form's fields, in the order they are displayed.
   *
   * @param formId - Id of the form.
   * @returns Its fields, in sequence order.
   * @example
   * const fields = await sdk.forms.listFields('form-1');
   */
  listFields(formId: string): Promise<FormField[]> {
    return this.call(formsOperations.listFields, { formId });
  }

  /**
   * Find which form applies in one particular context.
   *
   * @param contextId - Id of the board, stage or release change.
   * @param contextType - Which kind of context that id is.
   * @param entityType - Which record type the form applies to.
   * @returns The mapping, or `null` when no form is bound there.
   * @example
   * const mapping = await sdk.forms.getMapping('board-1', 'BOARD', 'TICKET');
   */
  getMapping(
    contextId: string,
    contextType: FormContextType,
    entityType: FormEntityType
  ): Promise<FormContextMapping | null> {
    return this.call(formsOperations.getMapping, { contextId, contextType, entityType });
  }

  /**
   * List form mappings across several boards.
   *
   * @param boardIds - Boards to look up.
   * @returns Mappings bound to any of those boards.
   * @example
   * const mappings = await sdk.forms.listMappingsForBoards(['board-1']);
   */
  listMappingsForBoards(boardIds: string[]): Promise<FormContextMapping[]> {
    return this.call(formsOperations.listMappingsForBoards, { boardIds });
  }

  /**
   * List the values submitted for one entity.
   *
   * @param entityId - Id of the ticket or sub-ticket.
   * @returns Its recorded field values.
   * @example
   * const values = await sdk.forms.listValues('ticket-123');
   */
  listValues(entityId: string): Promise<FormEntityValue[]> {
    return this.call(formsOperations.listValues, { entityId });
  }

  /**
   * List every ticket form value in the workspace.
   *
   * @returns All recorded values across every ticket.
   * @example
   * const values = await sdk.forms.listAllTicketValues();
   */
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
   * @param data - The form and its complete field list.
   * @param data.formId - Existing form to update. Omit to create.
   * @param data.fields - The complete set of fields to keep.
   * @param data.projectId - Project the form belongs to.
   * @param data.formDescription - Description shown above the form.
   * @returns The form id, generated when creating.
   * @example
   * const { formId } = await sdk.forms.update({
   *   fields: [{ id: 'field-1', label: 'Impact', fieldType: 'TEXT', sequence: 0 }],
   * });
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
   * @param data - What to bind, and where.
   * @param data.contextId - Id of the board, stage or release change.
   * @param data.contextType - Which kind of context that id is.
   * @param data.entityType - Which record type the form applies to.
   * @param data.formId - Form to bind.
   * @returns The new mapping's id.
   * @example
   * const { mappingId } = await sdk.forms.setMapping({
   *   contextId: 'board-1',
   *   contextType: 'BOARD',
   *   entityType: 'TICKET',
   *   formId: 'form-1',
   * });
   */
  async setMapping(data: {
    contextId: string;
    contextType: FormContextType;
    entityType: FormEntityType;
    formId: string;
  }): Promise<{ mappingId: string }> {
    const mappingId = newId();
    await this.call(formsOperations.setMapping, { mappingId, ...data });
    return { mappingId };
  }

  /**
   * Unbind a form from a context.
   *
   * @param contextId - Id of the board, stage or release change.
   * @param contextType - Which kind of context that id is.
   * @param entityType - Which record type the binding covers.
   * @example
   * await sdk.forms.deleteMapping('board-1', 'BOARD', 'TICKET');
   */
  deleteMapping(
    contextId: string,
    contextType: FormContextType,
    entityType: FormEntityType
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
   * @param data - The value to record.
   * @param data.entityId - Ticket or sub-ticket the value belongs to.
   * @param data.entityType - Which of the two `entityId` is.
   * @param data.formId - Form the field belongs to.
   * @param data.fieldId - Field being filled in.
   * @param data.newValue - The value itself.
   * @param data.contextId - Board or stage the form was shown in.
   * @param data.version - Form version this value was captured against.
   * @returns The new value row's id.
   * @example
   * const { id } = await sdk.forms.createValue({
   *   entityId: 'ticket-1',
   *   entityType: 'TICKET',
   *   formId: 'form-1',
   *   fieldId: 'field-1',
   *   newValue: 'High',
   * });
   */
  async createValue(data: {
    entityId: string;
    entityType: FormEntityType;
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
   * @param formEntityValueId - Id of the value row to change.
   * @param newValue - The replacement value.
   * @param options.expectedValueUpdatedAt - The `updatedAt` you last read. When
   * supplied, the write is rejected if the value changed in the meantime.
   * @example
   * await sdk.forms.updateValue('value-1', 'Critical');
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
