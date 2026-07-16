import { FormContextType, FormEntityType, Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { resolveFormFieldDefinitionsForForm } from '@/utils/fieldDefinition';
import { createTicketCustomFieldActivity } from '@/services/ticketCustomFieldActivityService';
import { normalizeCustomFieldValue } from '@/apps/controllers/ticketController.helpers';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import {
  buildKanbanCountsSnapshot,
  type KanbanCountsSnapshot,
} from '@/services/tickets/kanbanCountsSnapshotService';
import { websocketService } from '@/services/websocketService';
import { emitEventToWorkspaceApps } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, type AdditionalFormFieldUpdatedPayload, type BaseAppEvent } from '@/apps/types';
import { normalizeVespaFieldValue } from '@/zero/vespa-injection/core/form-fields';
import { emitTicketUpdated } from '@/automations/triggers/ticket-updated.trigger';

/**
 * Shared ticket custom-field (form field) engine.
 *
 * Previously these helpers lived as module-local functions inside
 * `apps/controllers/ticketController.ts`. They were extracted here so BOTH the
 * apps ticket controller and the main `controllers/ticketController.ts` update
 * path can persist ticket custom fields through a single source of truth —
 * keeping normalization, USER-reference validation, version slicing, the
 * `form_entity_values` unique-key upsert, and activity logging consistent
 * across every write path.
 */

const prismaClient = DatabaseClient.getInstance();

export type CustomFieldWritePayload = {
  formId: string;
  contextId: string;
  fieldValues: Array<{
    fieldName: string;
    fieldId: string;
    fieldValue: string;
    actualFieldValue: Prisma.InputJsonValue;
  }>;
};

/**
 * Ensure every user id referenced by a USER-type field belongs to the given
 * workspace. Throws with a descriptive error listing the offending ids.
 */
export const validateUserCustomFieldReferences = async (
  fieldValues: Array<{
    fieldName: string;
    fieldType: string;
    actualFieldValue: Prisma.InputJsonValue;
  }>,
  workspaceId: string,
): Promise<void> => {
  const userFieldEntries = fieldValues.filter(fieldValue => fieldValue.fieldType === 'USER');
  if (userFieldEntries.length === 0) return;

  const userIds = Array.from(
    new Set(
      userFieldEntries.flatMap(fieldValue =>
        Array.isArray(fieldValue.actualFieldValue)
          ? fieldValue.actualFieldValue
          : [fieldValue.actualFieldValue],
      ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  );

  if (userIds.length === 0) return;

  const users = await prismaClient.user.findMany({
    where: {
      id: { in: userIds },
      workspaceId,
    },
    select: { id: true },
  });
  const validUserIds = new Set(users.map(user => user.id));

  for (const fieldValue of userFieldEntries) {
    const referencedUserIds = (
      Array.isArray(fieldValue.actualFieldValue)
        ? fieldValue.actualFieldValue
        : [fieldValue.actualFieldValue]
    ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const invalidUserIds = referencedUserIds.filter(userId => !validUserIds.has(userId));
    if (invalidUserIds.length > 0) {
      throw new Error(
        `Field "${fieldValue.fieldName}" contains invalid user ID${invalidUserIds.length > 1 ? 's' : ''}: ${invalidUserIds.join(', ')}`,
      );
    }
  }
};

/**
 * Resolve + normalize the board's form fields for a full write. Throws on the
 * first problem (unknown field, missing required field, invalid value). Best
 * suited to create flows where the whole form is submitted at once.
 */
export const buildCustomFieldWritePayload = async (
  boardId: string,
  workspaceId: string,
  dynamicFields: Record<string, unknown> | undefined,
  options?: { requireAllRequiredFields?: boolean },
): Promise<CustomFieldWritePayload | undefined> => {
  const normalizedInput = dynamicFields ?? {};
  const requireAllRequiredFields = options?.requireAllRequiredFields ?? true;
  const formMapping = await prismaClient.formContextMapping.findFirst({
    where: {
      contextId: boardId,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
    select: { formId: true },
  });

  if (!formMapping) {
    if (Object.keys(normalizedInput).length > 0) {
      throw new Error(`No form configured for board ${boardId}`);
    }
    return undefined;
  }

  const formFields = await resolveFormFieldDefinitionsForForm(prismaClient, formMapping.formId);

  const fieldByName = new Map(formFields.map(field => [field.fieldName, field]));
  const unknownFields = Object.keys(normalizedInput).filter(fieldName => !fieldByName.has(fieldName));
  if (unknownFields.length > 0) {
    throw new Error(`Unknown custom fields for board ${boardId}: ${unknownFields.join(', ')}`);
  }

  if (requireAllRequiredFields) {
    const requiredFields = formFields
      .filter(field => !field.isOptional)
      .map(field => field.fieldName)
      .filter(fieldName => normalizedInput[fieldName] === undefined || normalizedInput[fieldName] === null);

    if (requiredFields.length > 0) {
      throw new Error(`Missing required custom fields: ${requiredFields.join(', ')}`);
    }
  }

  const fieldValues = Object.entries(normalizedInput).map(([fieldName, rawValue]) => {
    const field = fieldByName.get(fieldName);
    if (!field) {
      throw new Error(`Unknown custom field: ${fieldName}`);
    }

    const normalized = normalizeCustomFieldValue(field, rawValue);
    return {
      fieldName,
      fieldId: field.id,
      fieldValue: normalized.fieldValue,
      actualFieldValue: normalized.actualFieldValue,
    };
  });

  await validateUserCustomFieldReferences(
    fieldValues.map(fieldValue => {
      const field = fieldByName.get(fieldValue.fieldName);
      return {
        fieldName: fieldValue.fieldName,
        fieldType: field?.fieldType ?? '',
        actualFieldValue: fieldValue.actualFieldValue,
      };
    }),
    workspaceId,
  );

  return {
    formId: formMapping.formId,
    contextId: boardId,
    fieldValues,
  };
};

/**
 * Partial variant used by update flows: only the provided fields are written,
 * and per-field problems are collected into `validationErrors` instead of
 * throwing, so a caller can surface all issues at once. `requireAllRequiredFields`
 * defaults to true — update paths should pass `false` so a partial field update
 * does not demand every required field on the board form.
 */
export const buildPartialCustomFieldWritePayload = async (
  boardId: string,
  workspaceId: string,
  dynamicFields: Record<string, unknown> | undefined,
  options?: { requireAllRequiredFields?: boolean },
): Promise<{
  customFieldValues?: CustomFieldWritePayload;
  validationErrors: Array<{ error: string; code: 'VALIDATION_ERROR' }>;
}> => {
  const normalizedInput = dynamicFields ?? {};
  const validationErrors: Array<{ error: string; code: 'VALIDATION_ERROR' }> = [];
  const requireAllRequiredFields = options?.requireAllRequiredFields ?? true;

  const formMapping = await prismaClient.formContextMapping.findFirst({
    where: {
      contextId: boardId,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
    select: { formId: true },
  });

  if (!formMapping) {
    if (Object.keys(normalizedInput).length > 0) {
      validationErrors.push({
        error: `No form configured for board ${boardId}`,
        code: 'VALIDATION_ERROR',
      });
    }
    return { validationErrors };
  }

  const formFields = await resolveFormFieldDefinitionsForForm(prismaClient, formMapping.formId);

  const fieldByName = new Map(formFields.map(field => [field.fieldName, field]));

  if (requireAllRequiredFields) {
    const requiredFields = formFields
      .filter(field => !field.isOptional)
      .map(field => field.fieldName)
      .filter(fieldName => normalizedInput[fieldName] === undefined || normalizedInput[fieldName] === null);

    if (requiredFields.length > 0) {
      validationErrors.push({
        error: `Missing required custom fields: ${requiredFields.join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }
  }

  const fieldValues: CustomFieldWritePayload['fieldValues'] = [];

  for (const [fieldName, rawValue] of Object.entries(normalizedInput)) {
    const field = fieldByName.get(fieldName);
    if (!field) {
      validationErrors.push({
        error: `Unknown custom field: ${fieldName}`,
        code: 'VALIDATION_ERROR',
      });
      continue;
    }

    try {
      const normalized = normalizeCustomFieldValue(field, rawValue);
      const fieldValue = {
        fieldName,
        fieldId: field.id,
        fieldValue: normalized.fieldValue,
        actualFieldValue: normalized.actualFieldValue,
      };

      await validateUserCustomFieldReferences(
        [{
          fieldName,
          fieldType: field.fieldType,
          actualFieldValue: fieldValue.actualFieldValue,
        }],
        workspaceId,
      );

      fieldValues.push(fieldValue);
    } catch (error) {
      validationErrors.push({
        error: error instanceof Error ? error.message : `Invalid value for field "${fieldName}"`,
        code: 'VALIDATION_ERROR',
      });
    }
  }

  if (fieldValues.length === 0) {
    return { validationErrors };
  }

  return {
    customFieldValues: {
      formId: formMapping.formId,
      contextId: boardId,
      fieldValues,
    },
    validationErrors,
  };
};

/**
 * A single custom field whose value was (re)written by `syncCustomFieldValues`,
 * carrying both the new value and its previous value so downstream side effects
 * can compute deltas.
 */
type ChangedCustomField = {
  fieldId: string;
  fieldName: string;
  newActualValue: Prisma.InputJsonValue;
  newFieldValue: string;
  previousValue: Prisma.JsonValue | undefined;
  hadPreviousValue: boolean;
};

/** Coerce an arbitrary custom-field value into the automation TicketChange scalar shape. */
const toTicketChangeValue = (value: unknown): string | number | null => {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value === null || value === undefined) return null;
  return String(value);
};

/** Structural equality for custom-field values (handles arrays/objects, not just scalars). */
const customFieldValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
};

/**
 * Replicate — for direct-Prisma custom-field writes — the same side effects the
 * Zero `FormEntityValuesSideEffectHandler` performs when `form_entity_values` is
 * mutated through the Zero pipeline:
 *   1. reindex the ticket in Vespa (custom fields are searchable/filterable),
 *   2. broadcast the kanban-count delta so custom-field grouped columns move
 *      without waiting for the counts UI stale window,
 *   3. emit ADDITIONAL_FORM_FIELD_UPDATED to workspace apps (one per field), and
 *   4. fire the TICKET_UPDATED automation trigger for fields that actually changed.
 *
 * Everything here is best-effort: the form values are already committed, so a
 * side-effect failure must never fail the caller's request. Activity rows are
 * NOT emitted here — `syncCustomFieldValues` already writes them.
 */
const emitCustomFieldWriteSideEffects = async (
  ticketId: string,
  changedFields: ChangedCustomField[],
  updatedBy: string,
): Promise<void> => {
  if (changedFields.length === 0) return;

  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      boardId: true,
      channelId: true,
      projectId: true,
      conversationId: true,
      workspaceId: true,
      createdBy: true,
    },
  });
  if (!ticket) {
    logger.warn('[TicketCustomFieldService] Ticket not found for custom-field side effects:', ticketId);
    return;
  }

  // 1. Reindex the ticket in Vespa.
  try {
    await vespaQueue.addJob({
      schema: ticketSchema,
      jobType: 'feed',
      docId: ticketId,
      userId: updatedBy,
      ...(ticket.workspaceId ? { workspaceId: ticket.workspaceId } : {}),
    });
  } catch (error) {
    logger.error('[TicketCustomFieldService] Failed to queue Vespa feed after custom-field write:', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Broadcast the kanban-count delta (current vs a snapshot reflecting the
  //    pre-write value of every changed field).
  try {
    const currentSnapshot = await buildKanbanCountsSnapshot(ticketId);
    if (currentSnapshot) {
      const previousFormFieldValues: KanbanCountsSnapshot['formFieldValues'] = {
        ...currentSnapshot.formFieldValues,
      };
      for (const field of changedFields) {
        if (field.hadPreviousValue) {
          previousFormFieldValues[field.fieldId] = field.previousValue ?? null;
        } else {
          delete previousFormFieldValues[field.fieldId];
        }
      }
      const previousSnapshot: KanbanCountsSnapshot = {
        ...currentSnapshot,
        formFieldValues: previousFormFieldValues,
      };
      websocketService.broadcastTicketCountsUpdate({
        operation: 'update',
        ticket: currentSnapshot,
        previousTicket: previousSnapshot,
      });
    }
  } catch (error) {
    logger.error('[TicketCustomFieldService] Failed to broadcast ticket counts after custom-field write:', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Emit ADDITIONAL_FORM_FIELD_UPDATED per field, and 4. fire TICKET_UPDATED
  //    for the fields that actually changed value.
  try {
    const board = await prismaClient.board.findUnique({
      where: { id: ticket.boardId },
      select: { name: true },
    });

    let channelId = ticket.channelId ?? '';
    if (ticket.conversationId) {
      const conversation = await prismaClient.conversation.findUnique({
        where: { conversationId: ticket.conversationId },
        select: { channelId: true },
      });
      channelId = conversation?.channelId || channelId;
    }

    const formFieldChanges: Record<string, { previousValue: string | number | null; newValue: string | number | null }> = {};

    for (const field of changedFields) {
      const previousRaw = field.hadPreviousValue ? field.previousValue : undefined;
      const previousFormValue = field.hadPreviousValue
        ? normalizeVespaFieldValue((previousRaw ?? null) as Prisma.JsonValue) || undefined
        : undefined;

      const payload: AdditionalFormFieldUpdatedPayload = {
        ticketId,
        conversationId: ticket.conversationId || '',
        channelId,
        boardId: ticket.boardId,
        boardName: board?.name || '',
        fieldName: field.fieldName,
        fieldValue: normalizeVespaFieldValue(field.newActualValue as unknown as Prisma.JsonValue) || '',
        previousValue: previousFormValue,
        updatedBy,
        workspaceId: ticket.workspaceId,
      };

      const event: BaseAppEvent = {
        eventType: AppEventType.ADDITIONAL_FORM_FIELD_UPDATED,
        payload,
        timestamp: new Date().toISOString(),
      };
      void emitEventToWorkspaceApps(ticket.workspaceId, event);

      // Skip no-op writes for the automation trigger so identical re-submits do
      // not spam TICKET_UPDATED automations.
      const valueChanged =
        !field.hadPreviousValue || !customFieldValuesEqual(previousRaw, field.newActualValue);
      if (valueChanged) {
        formFieldChanges[field.fieldId] = {
          previousValue: toTicketChangeValue(previousRaw ?? null),
          newValue: toTicketChangeValue(field.newActualValue),
        };
      }
    }

    if (Object.keys(formFieldChanges).length > 0) {
      void emitTicketUpdated({
        ticket,
        changes: {},
        formFieldChanges,
        performedById: updatedBy,
      });
    }
  } catch (error) {
    logger.error('[TicketCustomFieldService] Failed to emit form-field events after custom-field write:', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Persist a resolved custom-field payload onto a ticket. Version-slices per
 * (entityId, entityType, contextId), upserts one `form_entity_values` row per
 * field using the composite unique key, writes a METADATA TicketActivity
 * capturing the old/new value for each field, and then fires the same
 * best-effort ticket side effects (Vespa reindex, kanban-count broadcast,
 * app + automation events) that the Zero form-entity-values handler performs —
 * so direct-Prisma custom-field writes stay consistent with Zero-driven ones.
 */
export const syncCustomFieldValues = async (
  ticketId: string,
  customFieldValues: CustomFieldWritePayload,
  updatedBy: string,
): Promise<void> => {
  const latestValue = await prismaClient.formEntityValues.findFirst({
    where: {
      entityId: ticketId,
      entityType: FormEntityType.TICKET,
      contextId: customFieldValues.contextId,
    },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const currentVersion = latestValue?.version ?? 1;
  const existingValues = await prismaClient.formEntityValues.findMany({
    where: {
      entityId: ticketId,
      entityType: FormEntityType.TICKET,
      contextId: customFieldValues.contextId,
      version: currentVersion,
      fieldId: { in: customFieldValues.fieldValues.map(fieldValue => fieldValue.fieldId) },
    },
    select: {
      fieldId: true,
      fieldValue: true,
      actualFieldValue: true,
    },
  });
  const existingValueByFieldId = new Map(existingValues.map(value => [value.fieldId, value]));

  await Promise.all(
    customFieldValues.fieldValues.map(async fieldValue => {
      const existingValue = existingValueByFieldId.get(fieldValue.fieldId);
      await prismaClient.formEntityValues.upsert({
        where: {
          entityId_entityType_fieldId_contextId_version: {
            entityId: ticketId,
            entityType: FormEntityType.TICKET,
            fieldId: fieldValue.fieldId,
            contextId: customFieldValues.contextId,
            version: currentVersion,
          },
        },
        create: {
          entityId: ticketId,
          entityType: FormEntityType.TICKET,
          formId: customFieldValues.formId,
          fieldId: fieldValue.fieldId,
          contextId: customFieldValues.contextId,
          version: currentVersion,
          fieldValue: fieldValue.fieldValue,
          actualFieldValue: fieldValue.actualFieldValue,
        },
        update: {
          fieldValue: fieldValue.fieldValue,
          actualFieldValue: fieldValue.actualFieldValue,
          updatedAt: new Date(),
        },
      });

      await createTicketCustomFieldActivity({
        ticketId,
        fieldName: fieldValue.fieldName,
        oldValue: existingValue?.actualFieldValue ?? existingValue?.fieldValue,
        newValue: fieldValue.actualFieldValue,
        updatedBy,
      });
    }),
  );

  const changedFields: ChangedCustomField[] = customFieldValues.fieldValues.map(fieldValue => {
    const existingValue = existingValueByFieldId.get(fieldValue.fieldId);
    return {
      fieldId: fieldValue.fieldId,
      fieldName: fieldValue.fieldName,
      newActualValue: fieldValue.actualFieldValue,
      newFieldValue: fieldValue.fieldValue,
      previousValue: existingValue
        ? (existingValue.actualFieldValue ?? existingValue.fieldValue)
        : undefined,
      hadPreviousValue: existingValueByFieldId.has(fieldValue.fieldId),
    };
  });

  await emitCustomFieldWriteSideEffects(ticketId, changedFields, updatedBy).catch(error => {
    logger.error('[TicketCustomFieldService] Custom-field side effects failed:', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
