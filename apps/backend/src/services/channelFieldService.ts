/**
 * Channel fields: values that describe a channel (e.g. which merchant it is for), defined by the
 * workspace's channel form (WORKSPACE context, CHANNEL entity) and stored like ticket fields, one
 * form_entity_values row per channel per field. A Channels desk copies them onto the tickets it opens.
 */
import { Prisma } from '@prisma/client';
import {
  FormContextType,
  FormEntityType,
  FormFieldType,
  type FormEntityValueRead,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { normalizeCustomFieldValue } from '@/apps/controllers/ticketController.helpers';
import {
  createFormEntityValues,
  findFormEntityValues,
  upsertFormEntityValue,
} from '@/database/repositories/formEntityValueRepository';
import { resolveFormFieldDefinitionsForForm, type ResolvedFormFieldDefinition } from '@/utils/fieldDefinition';

type Client = Pick<
  Prisma.TransactionClient,
  'formContextMapping' | 'formFields' | 'formEntityValues' | 'formEntityValueItems'
>;

export class ChannelFieldError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ChannelFieldValue {
  fieldId: string;
  fieldType: string;
  value: Prisma.InputJsonValue | null;
}

/** The workspace's channel form and its fields, or null if none is set up. */
async function channelForm(
  client: Client,
  workspaceId: string,
): Promise<{ formId: string; fields: ResolvedFormFieldDefinition[] } | null> {
  const mapping = await client.formContextMapping.findFirst({
    where: { contextId: workspaceId, contextType: FormContextType.WORKSPACE, entityType: FormEntityType.CHANNEL },
    select: { formId: true },
  });
  if (!mapping) return null;
  return { formId: mapping.formId, fields: await resolveFormFieldDefinitionsForForm(client, mapping.formId) };
}

export interface PreparedChannelFields {
  formId: string;
  values: ChannelFieldValue[];
}

/**
 * Checks channel fields given by name, e.g. `{ "Merchant ID": "M123" }`, without writing them.
 * Unknown names and invalid values are refused.
 */
export async function prepareChannelFields(
  workspaceId: string,
  input: Record<string, unknown>,
): Promise<PreparedChannelFields | null> {
  const names = Object.keys(input);
  if (names.length === 0) return null;
  const form = await channelForm(db, workspaceId);
  if (!form) {
    throw new ChannelFieldError('NO_CHANNEL_FIELDS', 'This workspace has no channel fields set up.');
  }
  const byName = new Map(form.fields.map((field) => [field.fieldName, field]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    throw new ChannelFieldError('UNKNOWN_FIELD', `Unknown channel fields: ${unknown.join(', ')}`);
  }
  const values: ChannelFieldValue[] = names.map((name) => {
    const field = byName.get(name)!;
    const raw = input[name];
    // null, "" or [] clears the field, as clearing it in the UI does.
    if (raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      return { fieldId: field.id, fieldType: field.fieldType, value: null };
    }
    try {
      return {
        fieldId: field.id,
        fieldType: field.fieldType,
        value: normalizeCustomFieldValue(field, raw).value,
      };
    } catch (err) {
      throw new ChannelFieldError('INVALID_VALUE', err instanceof Error ? err.message : `Invalid value for "${name}"`);
    }
  });
  return { formId: form.formId, values };
}

/** Writes checked channel fields, replacing the channel's current value for each. */
export async function writeChannelFields(
  workspaceId: string,
  channelId: string,
  { formId, values }: PreparedChannelFields,
): Promise<void> {
  for (const { fieldId, fieldType, value } of values) {
    // version 1, as the UI writes it: a null version never clashes in the unique key, so two writes at once
    // would each add a row. With it, the database keeps one row per field and the later write wins.
    const key = { entityId: channelId, entityType: FormEntityType.CHANNEL, fieldId, contextId: workspaceId, version: 1 };
    await upsertFormEntityValue(db, { workspaceId, formId, ...key, fieldType, value });
  }
}

// An option value must be one of its field's own options, which another field may not have; so these only copy onto the same definition.
const OPTION_TYPES = new Set<string>([FormFieldType.SINGLE_SELECT, FormFieldType.MULTI_SELECT]);

function isEmptyValue(value: FormEntityValueRead): boolean {
  return value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Copies a channel's fields onto a new ticket of the given board, inside the ticket's transaction.
 * A value lands on the board field with the same definition (global field), else one with the same
 * name and type (not for option fields). Values the board can't take are skipped and logged; the copy
 * never fails the ticket.
 */
export async function copyChannelFieldsToTicket(
  client: Client,
  args: { workspaceId: string; channelId: string; ticketId: string; boardId: string },
): Promise<void> {
  const values = await findFormEntityValues(client, {
    where: { entityType: FormEntityType.CHANNEL, entityId: args.channelId },
  });
  if (values.length === 0) return;
  const boardMapping = await client.formContextMapping.findFirst({
    where: { contextId: args.boardId, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
    select: { formId: true },
  });
  if (!boardMapping) return;
  const [boardFields, form] = await Promise.all([
    resolveFormFieldDefinitionsForForm(client, boardMapping.formId),
    channelForm(client, args.workspaceId),
  ]);
  const boardById = new Map(boardFields.map((field) => [field.id, field]));
  const boardByName = new Map(boardFields.map((field) => [field.fieldName, field]));
  const channelFieldOf = new Map((form?.fields ?? []).map((field) => [field.id, field]));

  const skipped: string[] = [];
  const copied = new Set<string>();
  const rows = values.flatMap((value) => {
    const current = value.value;
    if (current === null || isEmptyValue(current)) return [];
    // Only the current channel form's fields; values left from a replaced form aren't the channel's any more.
    const source = channelFieldOf.get(value.fieldId);
    if (!source) return [];
    const byName = boardByName.get(source.fieldName);
    const target =
      boardById.get(value.fieldId) ??
      (byName && byName.fieldType === source.fieldType && !OPTION_TYPES.has(byName.fieldType) ? byName : undefined);
    if (!target) {
      skipped.push(source.fieldName);
      return [];
    }
    // One value per ticket field: two channel fields can map to the same one.
    if (copied.has(target.id)) return [];
    copied.add(target.id);
    return [
      {
        fieldType: target.fieldType,
        value: current,
        workspaceId: args.workspaceId,
        entityType: FormEntityType.TICKET,
        entityId: args.ticketId,
        formId: boardMapping.formId,
        fieldId: target.id,
        contextId: args.boardId,
        version: 1,
      },
    ];
  });
  if (skipped.length > 0) {
    logger.warn('[channels-desk] Channel fields not copied: the board has no matching field', {
      ticketId: args.ticketId,
      boardId: args.boardId,
      channelId: args.channelId,
      fields: skipped,
    });
  }
  if (rows.length > 0) {
    await createFormEntityValues(client, rows, { skipDuplicates: true });
  }
}
