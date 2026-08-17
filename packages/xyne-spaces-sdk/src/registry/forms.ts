/**
 * Forms Operation Registry
 *
 * Custom forms attached to work items. A form owns a set of fields; a context
 * mapping binds a form to where it applies (a board, a stage, a channel); and
 * entity values are the answers submitted for one entity, typically a ticket.
 *
 * There is no create-form mutator in the catalog — `update` both creates and
 * edits, and it replaces the whole field list each time.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { Form, FormEntityValue, FormField } from '../types/index.js';

/** A field as accepted by `form.update`, which replaces the whole field list. */
export interface FormFieldInput {
  /** Omit to create a field; pass an existing id to keep it. */
  id?: string;
  fieldName?: string;
  fieldType?: string;
  fieldEnum?: unknown;
  fieldOptions?: string;
  isOptional?: boolean;
  sequenceNumber?: number;
  globalFieldId?: string;
  parentOptionId?: string;
}

export const formsOperations = {
  // ----- Reads -----

  /**
   * One form by id, without its fields.
   * Maps to: Zero query 'getFormById'
   *
   * Fields come separately via `listFields` — this returns the form row alone.
   */
  get: query<{ formId: string }, Form | null>('getFormById'),

  /**
   * Every form, with its fields and context mappings resolved.
   * Maps to: Zero query 'getAllForms'
   */
  list: query<void, Form[]>('getAllForms'),

  /**
   * Forms without their relations — for pickers.
   * Maps to: Zero query 'getAllFormsList'
   */
  listLite: query<void, Form[]>('getAllFormsList'),

  /**
   * Forms bound to a kind of context (board, stage, channel).
   * Maps to: Zero query 'getFormsByContextType'
   */
  listByContextType: query<{ contextType: string }, Form[]>('getFormsByContextType'),

  /**
   * A form's fields, in sequence order.
   * Maps to: Zero query 'getFormFieldsByFormId'
   */
  listFields: query<{ formId: string }, FormField[]>('getFormFieldsByFormId'),

  /**
   * Which form applies in a particular context.
   * Maps to: Zero query 'getFormMappingByContextId'
   */
  getMapping: query<
    { contextId: string; contextType: string; entityType: string },
    unknown
  >('getFormMappingByContextId'),

  /**
   * Form mappings across several boards.
   * Maps to: Zero query 'getFormMappingsByBoardIds'
   */
  listMappingsForBoards: query<{ boardIds: string[] }, unknown[]>(
    'getFormMappingsByBoardIds'
  ),

  /**
   * The values submitted for one entity, e.g. a ticket.
   * Maps to: Zero query 'getFormEntityValuesByEntityId'
   */
  listValues: query<{ entityId: string }, FormEntityValue[]>(
    'getFormEntityValuesByEntityId'
  ),

  /**
   * Every ticket form value in the workspace.
   * Maps to: Zero query 'getAllFormEntityValues'
   */
  listAllTicketValues: query<void, FormEntityValue[]>('getAllFormEntityValues'),

  // ----- Writes -----

  /**
   * Create or update a form and its fields.
   *
   * `fields` replaces the entire field list: send every field you want to keep,
   * each with its existing `id`, or it will be dropped.
   * Maps to: Zero mutator 'form.update'
   */
  update: mutator<
    {
      formId: string;
      fields: FormFieldInput[];
      projectId?: string;
      formDescription?: string;
    },
    void
  >('form.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Bind a form to a context.
   * Maps to: Zero mutator 'formContextMapping.upsert'
   */
  setMapping: mutator<
    {
      mappingId: string;
      contextId: string;
      contextType: string;
      entityType: string;
      formId: string;
    },
    void
  >('formContextMapping.upsert'),

  /**
   * Unbind a form from a context.
   * Maps to: Zero mutator 'formContextMapping.delete'
   */
  deleteMapping: mutator<
    { contextId: string; contextType: string; entityType: string },
    void
  >('formContextMapping.delete'),

  /**
   * Record a value for a form field on an entity.
   * Maps to: Zero mutator 'formEntityValue.createV2'
   */
  createValue: mutator<
    {
      id: string;
      entityId: string;
      entityType: string;
      formId: string;
      fieldId: string;
      newValue: unknown;
      contextId?: string;
      version?: number;
    },
    void
  >('formEntityValue.createV2', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Change a recorded value.
   *
   * `expectedValueUpdatedAt` is an optimistic-concurrency check: pass the
   * `updatedAt` you last read and the write is rejected if someone else has
   * changed the value since.
   * Maps to: Zero mutator 'formEntityValue.update'
   */
  updateValue: mutator<
    { formEntityValueId: string; newValue: unknown; expectedValueUpdatedAt?: number },
    void
  >('formEntityValue.update', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),
} as const;
