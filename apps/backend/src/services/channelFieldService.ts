/**
 * Channel fields: values that describe a channel (e.g. which merchant it is for), defined by the
 * workspace's channel form (WORKSPACE context, CHANNEL entity) and stored like ticket fields, one
 * form_entity_values row per channel per field. A Channels desk copies them onto the tickets it opens.
 */
import type { Prisma } from '@prisma/client';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { normalizeCustomFieldValue } from '@/apps/controllers/ticketController.helpers';
import { resolveFormFieldDefinitionsForForm, type ResolvedFormFieldDefinition } from '@/utils/fieldDefinition';

type Client = Pick<Prisma.TransactionClient, 'formContextMapping' | 'formFields' | 'formEntityValues'>;

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
  fieldValue: string;
  actualFieldValue: Prisma.InputJsonValue;
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
    try {
      return { fieldId: field.id, ...normalizeCustomFieldValue(field, input[name]) };
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
  for (const value of values) {
    const existing = await db.formEntityValues.findFirst({
      where: { entityType: FormEntityType.CHANNEL, entityId: channelId, fieldId: value.fieldId },
      select: { id: true },
    });
    if (existing) {
      await db.formEntityValues.update({
        where: { id: existing.id },
        data: { fieldValue: value.fieldValue, actualFieldValue: value.actualFieldValue },
      });
    } else {
      await db.formEntityValues.create({
        data: {
          workspaceId,
          entityType: FormEntityType.CHANNEL,
          entityId: channelId,
          formId,
          contextId: workspaceId,
          ...value,
        },
      });
    }
  }
}

/**
 * Copies a channel's fields onto a new ticket of the given board, inside the ticket's transaction.
 * A value lands on the board field with the same definition (global field), else the same name;
 * fields the board doesn't have are skipped.
 */
export async function copyChannelFieldsToTicket(
  client: Client,
  args: { workspaceId: string; channelId: string; ticketId: string; boardId: string },
): Promise<void> {
  const values = await client.formEntityValues.findMany({
    where: { entityType: FormEntityType.CHANNEL, entityId: args.channelId },
    select: { fieldId: true, fieldValue: true, actualFieldValue: true },
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
  const nameOf = new Map((form?.fields ?? []).map((field) => [field.id, field.fieldName]));

  const rows = values.flatMap((value) => {
    const name = nameOf.get(value.fieldId);
    const target = boardById.get(value.fieldId) ?? (name ? boardByName.get(name) : undefined);
    if (!target) return [];
    return [
      {
        workspaceId: args.workspaceId,
        entityType: FormEntityType.TICKET,
        entityId: args.ticketId,
        formId: boardMapping.formId,
        fieldId: target.id,
        contextId: args.boardId,
        // actualFieldValue is the current value (edits through the app only update it).
        fieldValue: typeof value.actualFieldValue === 'string' ? value.actualFieldValue : value.fieldValue,
        actualFieldValue: value.actualFieldValue ?? value.fieldValue,
      },
    ];
  });
  if (rows.length > 0) await client.formEntityValues.createMany({ data: rows });
}
