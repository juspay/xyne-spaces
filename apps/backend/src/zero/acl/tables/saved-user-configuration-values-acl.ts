import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { FormFieldType, SavedConfigEntityName, Schema, TicketPriority, schema, parseFieldOptionValues } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema, type QueryContext } from '../core/types';
import { zql } from '../../queries';

const ticketCols = schema.tables.tickets.columns;
const tagCols = schema.tables.ticket_tags.columns;

type AnySchemaColumn =
  | (typeof ticketCols)[keyof typeof ticketCols]
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
  // Direct column mappings
  boards:              { col: ticketCols.boardId,        enumValues: null },
  assignee:            { col: ticketCols.assignedTo,     enumValues: null },
  createdBy:           { col: ticketCols.createdBy,      enumValues: null },
  userGroups:          { col: ticketCols.userGroupId,    enumValues: null },
  tags:                { col: tagCols.name,              enumValues: null },
  generatedTags:       { col: tagCols.name,              enumValues: null },
  stages:              { col: ticketCols.stageName,      enumValues: null },
  ticketTypes:         { col: ticketCols.ticketType,     enumValues: null },
  sourceChannels:      { col: ticketCols.channelId,      enumValues: null },
  conversationLabelId: { col: ticketCols.id,             enumValues: null },
  aiCategory:          { col: ticketCols.aiCategory,     enumValues: null },
  dueDateStart:        { col: ticketCols.eta,            enumValues: null },
  dueDateEnd:          { col: ticketCols.eta,            enumValues: null },
  createdDateStart:    { col: ticketCols.createdAt,      enumValues: null },
  createdDateEnd:      { col: ticketCols.createdAt,      enumValues: null },
  lastEmailAtStart:    { col: ticketCols.lastEmailAt,    enumValues: null },
  lastEmailAtEnd:      { col: ticketCols.lastEmailAt,    enumValues: null },
  priority:            { col: ticketCols.priority,       enumValues: new Set(Object.values(TicketPriority)) },
};

function validateTicketValue(fieldName: string, fieldValue: string): void {
  const table = 'saved_user_configuration_values' as const;

  if (fieldName === '__columns') return;

  if (!fieldValue) {
    throw new MutationACLError(`Field value cannot be empty for field: ${fieldName}`, table);
  }

  // Virtual UI-state field (the groupBy column name), not a real column.
  if (fieldName === '__groupBy') return;

  // Boolean filters — value must be "true" or "false"
  if (
    fieldName === 'assigned' ||
    fieldName === 'created' ||
    fieldName === 'hasAiDraft' ||
    fieldName === 'hasSubTickets'
  ) {
    if (fieldValue !== 'true' && fieldValue !== 'false') {
      throw new MutationACLError(`${fieldName} must be "true" or "false"`, table);
    }
    return;
  }

  // Dynamic form field values — serialized as "dynamicFields.<fieldId>" with JSON value
  if (fieldName.startsWith('dynamicFields.')) return;

  if (fieldName === 'roleAssignments') {
    const [roleId, userIdsCsv] = fieldValue.split('|');
    if (!roleId) {
      throw new MutationACLError(`roleAssignments must include a roleId`, table);
    }
    if (!userIdsCsv) {
      throw new MutationACLError(`roleAssignments must include at least one userId`, table);
    }
    const userIds = userIdsCsv.split(',').filter(Boolean);
    if (userIds.length === 0) {
      throw new MutationACLError(`roleAssignments must include at least one userId`, table);
    }
    return;
  }

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
      const options = parseFieldOptionValues(formField.fieldOptions ?? formField.fieldEnum);
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

const DESK_METRICS_FIELD_WHITELIST = new Set([
  'rangeLabel',
  'customStart',
  'customEnd',
  'startTime',
  'endTime',
  'selectedAssigneeIds',
  'selectedStageNames',
  'selectedPriorities',
  'selectedUserGroupIds',
  'selectedTagCategory',
  'selectedTagValues',
  'selectedAiCategories',
  'comparedChannelIds',
  'chartView',
  'activeTab',
]);

function validateDeskMetricsValue(fieldName: string): void {
  // Custom field values are serialized as "selectedCustomFieldValues.<fieldId>"
  if (fieldName.startsWith('selectedCustomFieldValues.')) return;
  if (!DESK_METRICS_FIELD_WHITELIST.has(fieldName)) {
    throw new MutationACLError(
      `Invalid desk metrics field: ${fieldName}`,
      'saved_user_configuration_values',
    );
  }
}

export class SavedUserConfigurationValuesACL extends BaseACL<'saved_user_configuration_values'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'saved_user_configuration_values');
  }

  /**
   * A value belongs to whoever owns its saved view. Mutators address these rows by their own
   * id, never through the parent, so the parent's rule has to be restated here rather than
   * assumed — it is the only thing tying a value to a person.
   */
  private async assertOwnsConfig(configId: string, tx: Transaction<Schema>): Promise<void> {
    const config = await tx.run(zql.saved_user_configurations.where('id', configId).one());
    if (!config || config.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Saved view value failed: view not found', 'saved_user_configuration_values');
    }
    if (config.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Saved view value failed: you can only change values on your own saved views',
        'saved_user_configuration_values',
      );
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'saved_user_configuration_values'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.assertOwnsConfig(args.configId, tx);

    switch (args.entityName) {
      case SavedConfigEntityName.TICKET:
        validateTicketValue(args.fieldName, args.fieldValue);
        break;
      case SavedConfigEntityName.FORM_ENTITY_VALUE:
        await validateFormEntityValue(args.fieldName, args.fieldValue, tx);
        break;
      case SavedConfigEntityName.DESK_METRICS:
        validateDeskMetricsValue(args.fieldName);
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
    const existing = await tx.run(zql.saved_user_configuration_values.where('id', args.id).one());
    if (!existing) {
      throw new MutationACLError('Saved view value failed: value not found', 'saved_user_configuration_values');
    }
    await this.assertOwnsConfig(existing.configId, tx);
    // Re-pointing a value at someone else's view would move it out of reach of the check above.
    if (args.configId !== undefined && args.configId !== existing.configId) {
      await this.assertOwnsConfig(args.configId, tx);
    }

    if (args.entityName !== undefined && args.fieldName !== undefined && args.fieldValue !== undefined) {
      switch (args.entityName) {
        case SavedConfigEntityName.TICKET:
          validateTicketValue(args.fieldName, args.fieldValue);
          break;
        case SavedConfigEntityName.FORM_ENTITY_VALUE:
          await validateFormEntityValue(args.fieldName, args.fieldValue, tx);
          break;
        case SavedConfigEntityName.DESK_METRICS:
          validateDeskMetricsValue(args.fieldName);
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
    args: DeleteID<TableSchema<'saved_user_configuration_values'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const existing = await tx.run(zql.saved_user_configuration_values.where('id', args.id).one());
    if (!existing) {
      throw new MutationACLError('Saved view value failed: value not found', 'saved_user_configuration_values');
    }
    await this.assertOwnsConfig(existing.configId, tx);
  }
}
