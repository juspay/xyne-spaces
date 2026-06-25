import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { FormFieldType, SavedConfigEntityName, Schema, TicketPriority, schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema, type QueryContext } from '../core/types';
import { zql } from '../../queries';

const ticketCols = schema.tables.tickets.columns;
const assignmentCols = schema.tables.ticket_assignments.columns;
const tagCols = schema.tables.ticket_tags.columns;

type AnySchemaColumn =
  | (typeof ticketCols)[keyof typeof ticketCols]
  | (typeof assignmentCols)[keyof typeof assignmentCols]
  | (typeof tagCols)[keyof typeof tagCols];

interface TicketFilterFieldDescriptor {
  /** The actual Zero schema column this filter key maps to. */
  col: AnySchemaColumn;
  /** Required only for enum-typed fields — the set of allowed string values. */
  enumValues: Set<string> | null;
}

/**
 * Maps each allowed TICKET filter key to its Zero schema column and (for enums) its allowed values.
 * Any fieldName not present here is rejected as unknown.
 * Column type (string vs number) is derived from col.type at runtime — not hardcoded.
 */
const TICKET_FILTER_SCHEMA: Record<string, TicketFilterFieldDescriptor> = {
  boards:           { col: ticketCols.boardId,         enumValues: null },
  assignee:         { col: ticketCols.assignedTo,      enumValues: null },
  createdBy:        { col: ticketCols.createdBy,       enumValues: null },
  userGroups:       { col: ticketCols.userGroupId,     enumValues: null },
  prReviewers:      { col: assignmentCols.userId,      enumValues: null },
  qaAssigned:       { col: assignmentCols.userId,      enumValues: null },
  tags:             { col: tagCols.name,               enumValues: null },
  stages:           { col: ticketCols.stageName,       enumValues: null },
  ticketTypes:      { col: ticketCols.ticketType,      enumValues: null },
  dueDateStart:     { col: ticketCols.eta,             enumValues: null },
  dueDateEnd:       { col: ticketCols.eta,             enumValues: null },
  createdDateStart: { col: ticketCols.createdAt,       enumValues: null },
  createdDateEnd:   { col: ticketCols.createdAt,       enumValues: null },
  priority:         { col: ticketCols.priority,        enumValues: new Set(Object.values(TicketPriority)) },
};

function validateTicketValue(fieldName: string, fieldValue: string): void {
  const table = 'saved_user_configuration_values' as const;

  if (!fieldValue) {
    throw new MutationACLError(`Field value cannot be empty for field: ${fieldName}`, table);
  }

  // Virtual UI-state field (the groupBy column name), not a real column.
  if (fieldName === '__groupBy') return;

  const descriptor = TICKET_FILTER_SCHEMA[fieldName];
  if (!descriptor) {
    throw new MutationACLError(`Unknown field name "${fieldName}" for entity TICKET`, table);
  }

  switch (descriptor.col.type) {
    case 'number':
      if (isNaN(Number(fieldValue))) {
        throw new MutationACLError(`Field ${fieldName} must be a numeric timestamp`, table);
      }
      break;
    case 'string':
      if (descriptor.enumValues !== null && !descriptor.enumValues.has(fieldValue)) {
        throw new MutationACLError(
          `Invalid value "${fieldValue}" for field "${fieldName}"`,
          table,
        );
      }
      break;
    default:
      throw new MutationACLError(
        `Unsupported column type "${descriptor.col.type}" for field "${fieldName}"`,
        table,
      );
  }
}

/**
 * Validates a FORM_ENTITY_VALUE filter entry.
 *
 * fieldName is either:
 *   - "<fieldId>"         — for non-date fields (one row per selected value)
 *   - "<fieldId>.start"   — lower bound for DATE range filters
 *   - "<fieldId>.end"     — upper bound for DATE range filters
 *
 * The fieldId is looked up in form_fields to confirm it exists and to validate
 * the fieldValue against the actual field type.
 */
async function validateFormEntityValue(
  fieldName: string,
  fieldValue: string,
  tx: Transaction<Schema>,
): Promise<void> {
  const table = 'saved_user_configuration_values' as const;

  if (!fieldValue) {
    throw new MutationACLError(`Field value cannot be empty for field: ${fieldName}`, table);
  }

  // Extract fieldId and optional date bound suffix
  let fieldId = fieldName;
  let isDateBound = false;
  if (fieldName.endsWith('.start') || fieldName.endsWith('.end')) {
    fieldId = fieldName.slice(0, fieldName.lastIndexOf('.'));
    isDateBound = true;
  }

  const formField = await tx.run(zql.form_fields.where('id', fieldId).one());
  if (!formField) {
    throw new MutationACLError(
      `Unknown dynamic field id "${fieldId}"`,
      table,
    );
  }

  // Non-date fields must NOT use the .start / .end suffix
  if (isDateBound && formField.fieldType !== FormFieldType.DATE) {
    throw new MutationACLError(
      `Non-DATE field "${fieldId}" must not use ".start" or ".end" suffix`,
      table,
    );
  }

  switch (formField.fieldType) {
    case FormFieldType.DATE:
      if (!isDateBound) {
        throw new MutationACLError(
          `DATE field "${fieldId}" must use ".start" or ".end" suffix`,
          table,
        );
      }
      if (isNaN(Number(fieldValue))) {
        throw new MutationACLError(
          `DATE field "${fieldName}" must be a numeric timestamp`,
          table,
        );
      }
      break;

    case FormFieldType.NUMBER:
      if (isNaN(Number(fieldValue))) {
        throw new MutationACLError(
          `NUMBER field "${fieldId}" must be a numeric value`,
          table,
        );
      }
      break;

    case FormFieldType.BOOLEAN:
      if (fieldValue !== 'true' && fieldValue !== 'false') {
        throw new MutationACLError(
          `BOOLEAN field "${fieldId}" must be "true" or "false"`,
          table,
        );
      }
      break;

    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.MULTI_SELECT: {
      const options = Array.isArray(formField.fieldEnum) ? (formField.fieldEnum as string[]) : [];
      if (options.length > 0 && !options.includes(fieldValue)) {
        throw new MutationACLError(
          `Invalid value "${fieldValue}" for field "${fieldId}"`,
          table,
        );
      }
      break;
    }

    case FormFieldType.USER: {
      const user = await tx.run(zql.users.where('id', fieldValue).one());
      if (!user) {
        throw new MutationACLError(
          `Invalid user id "${fieldValue}" for field "${fieldId}"`,
          table,
        );
      }
      break;
    }

    case FormFieldType.STRING:
      // Any non-empty string is valid — already checked above
      break;
  }
}

export class SavedUserConfigurationValuesACL extends BaseACL<'saved_user_configuration_values'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'saved_user_configuration_values');
  }

  async canInsert(
    args: InsertValue<TableSchema<'saved_user_configuration_values'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    switch (args.entityName) {
      case SavedConfigEntityName.TICKET:
        validateTicketValue(args.fieldName, args.fieldValue);
        break;
      case SavedConfigEntityName.FORM_ENTITY_VALUE:
        await validateFormEntityValue(args.fieldName, args.fieldValue, tx);
        break;
      default:
        throw new MutationACLError(
          `Unsupported entity name: ${args.entityName}`,
          'saved_user_configuration_values',
        );
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'saved_user_configuration_values'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.entityName !== undefined && args.fieldName !== undefined && args.fieldValue !== undefined) {
      switch (args.entityName) {
        case SavedConfigEntityName.TICKET:
          validateTicketValue(args.fieldName, args.fieldValue);
          break;
        case SavedConfigEntityName.FORM_ENTITY_VALUE:
          await validateFormEntityValue(args.fieldName, args.fieldValue, tx);
          break;
        default:
          throw new MutationACLError(
            `Unsupported entity name: ${args.entityName}`,
            'saved_user_configuration_values',
          );
      }
    }
  }

  async canDelete(
    _args: DeleteID<TableSchema<'saved_user_configuration_values'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    // Delete is allowed — ownership is enforced at the parent config level
  }
}
