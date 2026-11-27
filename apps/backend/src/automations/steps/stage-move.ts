import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ActivityType,
  BoardType,
  FormContextType,
  FormEntityType,
  FormFieldType,
  isFieldActive,
  parseFieldOptionValues,
  sameFormEntityValue,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import {
  findFormEntityValues,
  upsertFormEntityValues,
  type FormEntityValueRecord,
} from '@/database/repositories/formEntityValueRepository';
import { normalizeCustomFieldValue } from '@/apps/controllers/ticketController.helpers';
import {
  emitCustomFieldWriteSideEffects,
  validateUserCustomFieldReferences,
  type ChangedCustomField,
} from '@/services/ticketCustomFieldService';
import {
  isStageTransitionApprover,
  ticketStageTransitionService,
} from '@/services/stageTransition/ticketStageTransitionService';
import { ActivitySource } from '@/types/ticket';
import {
  resolveFormFieldDefinitionsForForm,
  type ResolvedFormFieldDefinition,
} from '@/utils/fieldDefinition';
import { logger } from '@/utils/logger';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';

const StageFormValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
  .nullable()
  .optional()
  .describe(
    'Value to submit. Supports {{...}} placeholders. Multi-select and user fields take a list, or text with the values separated by commas.',
  );

export const StageFormValuesSchema = z
  .array(
    z.object({
      fieldName: z.string().min(1).describe('Name of a field on the form.'),
      value: variableRef(StageFormValueSchema),
    }),
  )
  .describe(
    'Fills the form this move needs: the transition form on non-linear boards, the stage form on linear boards. Required fields need a value; fields not on the form are skipped. Fails if the ticket is already in the stage, since nothing moves. Leave empty to move without a form.',
  );

export interface StageFormValueInput {
  fieldName: string;
  value?: unknown;
}

export interface StageMoveResult {
  savedFormFields: string[];
  skippedFormFields: string[];
}

interface PreparedFormValue {
  field: ResolvedFormFieldDefinition;
  value: Prisma.InputJsonValue;
  fieldValue: string;
}

interface PreparedForm {
  formId: string;
  fieldIds: string[];
  values: PreparedFormValue[];
  skipped: string[];
}

interface StageMoveArgs {
  ticketId: string;
  stageName: string;
  context: AutomationContext;
  stepType: string;
  formValues?: readonly StageFormValueInput[] | undefined;
}

/**
 * Moves a ticket the way the CHANGE_STAGE and UPDATE_TICKET steps always have. With form
 * values, it also fills the form the move needs, as the stage form modal does.
 */
export async function moveTicketToStage(args: StageMoveArgs): Promise<StageMoveResult> {
  const { ticketId, stageName, context, stepType } = args;
  const formValues = args.formValues ?? [];
  const updatedBy = context.automation.createdById;
  const prisma = DatabaseClient.getInstance();

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      stageName: true,
      boardId: true,
      workspaceId: true,
      board: { select: { boardType: true } },
    },
  });

  // A ticket already in the stage doesn't move, so there's no form to fill. Fail rather than
  // report success while dropping the values.
  if (ticket?.stageName === stageName && formValues.some(v => !isEmptyFormValue(v.value))) {
    throw new Error(
      `${stepType}: the ticket is already in "${stageName}", so its form values weren't saved. Form values are only saved when the step moves the ticket.`,
    );
  }
  // Without form values the step behaves exactly as before.
  const fillForm = ticket !== null && formValues.length > 0 && ticket.stageName !== stageName;
  const toResult = (form: PreparedForm | null): StageMoveResult => {
    const result = form
      ? { savedFormFields: form.values.map(v => v.field.fieldName), skippedFormFields: form.skipped }
      : {
          savedFormFields: [],
          skippedFormFields: formValues.filter(v => !isEmptyFormValue(v.value)).map(v => v.fieldName),
        };
    if (result.skippedFormFields.length > 0) {
      logger.warn(`[automations] ${stepType} skipped form values`, {
        ticketId,
        stageName,
        skippedFormFields: result.skippedFormFields,
      });
    }
    return result;
  };

  if (ticket?.board?.boardType === BoardType.NON_LINEAR) {
    const target = fillForm ? await findTransitionForm(ticket.boardId, ticket.stageName, stageName) : null;
    const form = target?.formId
      ? await prepareFormValues(target.formId, formValues, ticket.workspaceId, stepType)
      : null;
    // A move held for approval files its request without the form values, so they'd be lost.
    if (
      form &&
      target?.approvalTransitionId &&
      !(await isStageTransitionApprover(target.approvalTransitionId, updatedBy))
    ) {
      throw new Error(
        `${stepType}: moving to "${stageName}" needs approval, and an automation can't send form values for approval. Let automations skip approval on this transition.`,
      );
    }
    const before = form && target ? await findStageValues(ticketId, target.stageId, form.fieldIds) : [];

    const result = await ticketStageTransitionService.transitionTicket(ticketId, updatedBy, stageName, {
      isAutomation: true,
      activitySource: ActivitySource.AUTOMATION,
      ...(form && {
        formValues: Object.fromEntries(form.values.map(v => [v.field.fieldName, v.value])),
      }),
    });
    if (!result.success) {
      if (!form && result.transition?.formId && !result.requiresApproval) {
        throw new Error(
          `${stepType}: moving to "${stageName}" needs its form filled in. Fill it with form values on a "Move ticket to stage" step.`,
        );
      }
      throw new Error(result.message ?? 'Stage transition failed');
    }
    prisma.ticketActivity.create({
      data: {
        ticketId,
        updatedBy,
        workspaceId: context.automation.workspaceId,
        activityType: ActivityType.STAGE_NAME,
        value: { field: 'stageName', oldValue: ticket.stageName ?? null, newValue: stageName, source: ActivitySource.AUTOMATION, isAutomation: true },
      },
    }).catch(err => logger.warn(`[automations] ${stepType} stage audit write failed ticketId=${ticketId}:`, err));

    if (form && result.newVisitIndex !== undefined) {
      await emitFormSideEffects(ticketId, changedFields(form.values, before, result.newVisitIndex), updatedBy);
    }
    return toResult(form);
  }

  const isLinear =
    ticket?.board?.boardType === BoardType.DEFAULT || ticket?.board?.boardType === BoardType.RELEASE;
  const target = fillForm && ticket && isLinear ? await findStageForm(ticket.boardId, stageName) : null;
  const form =
    ticket && target?.formId
      ? await prepareFormValues(target.formId, formValues, ticket.workspaceId, stepType)
      : null;

  // Saved before the move, like the stage form modal: automations started by the move already see
  // the filled form. If the move then fails, the ticket stays put, so running the step again saves
  // the values again and moves it.
  let changed: ChangedCustomField[] | null = null;
  if (ticket && target && form && form.values.length > 0) {
    changed = await saveStageFormValues(ticketId, ticket.workspaceId, target.stageId, form).catch(
      (err: unknown) => {
        throw new Error(
          `${stepType}: couldn't save the form values for "${stageName}", so the ticket wasn't moved: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  }
  try {
    await repositories.tickets.updateTicketStage(ticketId, stageName, updatedBy, ActivitySource.AUTOMATION);
  } catch (err) {
    if (!changed) throw err;
    throw new Error(
      `${stepType}: saved the form values for "${stageName}" but couldn't move the ticket: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    // The values are saved whether or not the move worked, so search, counts and other automations
    // hear about them either way.
    if (changed) await emitFormSideEffects(ticketId, changed, updatedBy);
  }
  return toResult(form);
}

async function findTransitionForm(
  boardId: string,
  fromStageName: string,
  toStageName: string,
): Promise<{ stageId: string; formId: string | null; approvalTransitionId: string | null } | null> {
  const prisma = DatabaseClient.getInstance();
  const [target, current] = await Promise.all([
    prisma.stage.findFirst({ where: { boardId, name: toStageName }, select: { id: true } }),
    prisma.stage.findFirst({ where: { boardId, name: fromStageName }, select: { id: true } }),
  ]);
  if (!target) return null;
  const transition = current
    ? await prisma.stageTransition.findUnique({
        where: { boardId_fromStageId_toStageId: { boardId, fromStageId: current.id, toStageId: target.id } },
        select: { id: true, formId: true, requiresApproval: true, bypassApprovalForAutomation: true },
      })
    : null;
  return {
    stageId: target.id,
    formId: transition?.formId ?? null,
    // Set when the transition holds automation moves for approval, as transitionTicket does.
    approvalTransitionId:
      transition?.requiresApproval && !transition.bypassApprovalForAutomation ? transition.id : null,
  };
}

async function findStageForm(
  boardId: string,
  stageName: string,
): Promise<{ stageId: string; formId: string | null } | null> {
  const prisma = DatabaseClient.getInstance();
  const target = await prisma.stage.findFirst({ where: { boardId, name: stageName }, select: { id: true } });
  if (!target) return null;
  const mapping = await prisma.formContextMapping.findFirst({
    where: { contextId: target.id, contextType: FormContextType.STAGE },
    select: { formId: true },
  });
  return { stageId: target.id, formId: mapping?.formId ?? null };
}

/** Matches values to the form's fields, normalizes them and enforces required fields. */
async function prepareFormValues(
  formId: string,
  inputs: readonly StageFormValueInput[],
  workspaceId: string,
  stepType: string,
): Promise<PreparedForm> {
  const fields = await resolveFormFieldDefinitionsForForm(DatabaseClient.getInstance(), formId);
  const fieldByName = new Map(fields.map(f => [f.fieldName.trim().toLowerCase(), f]));
  const valueByFieldId = new Map<string, PreparedFormValue>();
  const skipped: string[] = [];

  for (const input of inputs) {
    if (isEmptyFormValue(input.value)) continue;
    const field = fieldByName.get(input.fieldName.trim().toLowerCase());
    if (!field) {
      skipped.push(input.fieldName);
      continue;
    }
    try {
      valueByFieldId.set(field.id, { field, ...normalizeFormValue(field, input.value) });
    } catch (err) {
      throw new Error(`${stepType}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Branch fields only count while their parent holds the matching option, as in the form UI.
  const parentValue = (fieldId: string): string | null => {
    const value = valueByFieldId.get(fieldId)?.value;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first : null;
  };
  let dropped: boolean;
  do {
    dropped = false;
    for (const [fieldId, entry] of valueByFieldId) {
      if (isFieldActive(entry.field, fields, parentValue)) continue;
      valueByFieldId.delete(fieldId);
      skipped.push(entry.field.fieldName);
      dropped = true;
    }
  } while (dropped);

  const missing = fields.filter(
    f => !f.isOptional && !valueByFieldId.has(f.id) && isFieldActive(f, fields, parentValue),
  );
  if (missing.length > 0) {
    const fileHint = missing.some(f => f.fieldType === FormFieldType.DOC)
      ? " (file fields can't be filled by an automation)"
      : '';
    throw new Error(
      `${stepType}: the form for this move needs ${missing.map(f => `"${f.fieldName}"`).join(', ')}${fileHint}`,
    );
  }

  const values = [...valueByFieldId.values()];
  try {
    await validateUserCustomFieldReferences(
      values.map(v => ({ fieldName: v.field.fieldName, fieldType: v.field.fieldType, value: v.value })),
      workspaceId,
    );
  } catch (err) {
    throw new Error(`${stepType}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { formId, fieldIds: fields.map(f => f.id), values, skipped };
}

function normalizeFormValue(
  field: ResolvedFormFieldDefinition,
  raw: unknown,
): { value: Prisma.InputJsonValue; fieldValue: string } {
  // Variables can resolve to numbers or booleans; text-like fields take them as text.
  const asText = (v: unknown): unknown => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v);
  switch (field.fieldType) {
    case FormFieldType.DOC:
      throw new Error(`"${field.fieldName}" is a file field and can't be filled by an automation`);
    case FormFieldType.TICKET: {
      const text = asText(Array.isArray(raw) ? raw[0] : raw);
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error(`Field "${field.fieldName}" must be a ticket ID`);
      }
      return { value: text.trim(), fieldValue: text.trim() };
    }
    case FormFieldType.STRING:
    case FormFieldType.SINGLE_SELECT:
      return normalizeCustomFieldValue(field, asText(raw));
    case FormFieldType.MULTI_SELECT:
    case FormFieldType.USER:
      return normalizeCustomFieldValue(
        field,
        Array.isArray(raw) ? raw.map(asText) : splitListText(field, asText(raw)),
      );
    default:
      return normalizeCustomFieldValue(field, raw);
  }
}

// Text lists several values with commas ("A, B"). A multi-select option that itself contains a
// comma is still taken whole when it is the entire text.
function splitListText(field: ResolvedFormFieldDefinition, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const isWholeOption =
    field.fieldType === FormFieldType.MULTI_SELECT &&
    parseFieldOptionValues(field.fieldEnum).includes(value.trim());
  return isWholeOption ? value : value.split(',');
}

function isEmptyFormValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.every(isEmptyFormValue);
  return false;
}

function findStageValues(
  ticketId: string,
  stageId: string,
  fieldIds: string[],
): Promise<FormEntityValueRecord[]> {
  return findFormEntityValues(DatabaseClient.getInstance(), {
    where: {
      entityId: ticketId,
      entityType: FormEntityType.TICKET,
      contextId: stageId,
      fieldId: { in: fieldIds },
    },
  });
}

/** Writes the stage form values of a linear-board move, all or none, and returns what changed. */
async function saveStageFormValues(
  ticketId: string,
  workspaceId: string,
  stageId: string,
  form: PreparedForm,
): Promise<ChangedCustomField[]> {
  const prisma = DatabaseClient.getInstance();
  const before = await findStageValues(ticketId, stageId, form.fieldIds);
  const eta = await prisma.ticketStageEta.aggregate({
    where: { ticketId, stageId },
    _max: { version: true },
  });
  // Linear boards keep one visit per stage; write to it like the form UI does.
  const version = Math.max(1, eta._max.version ?? 0, ...before.map(row => row.version ?? 1));
  const now = new Date();
  await upsertFormEntityValues(
    prisma,
    form.values.map(entry => ({
      entityId: ticketId,
      entityType: FormEntityType.TICKET,
      workspaceId,
      formId: form.formId,
      fieldId: entry.field.id,
      contextId: stageId,
      version,
      fieldType: entry.field.fieldType,
      value: entry.value,
      updatedAt: now,
    })),
  );
  return changedFields(form.values, before, version);
}

function changedFields(
  values: PreparedFormValue[],
  before: FormEntityValueRecord[],
  version: number,
): ChangedCustomField[] {
  const previousByFieldId = new Map(
    before.filter(row => (row.version ?? 1) === version).map(row => [row.fieldId, row.value]),
  );
  return values.flatMap((entry): ChangedCustomField[] => {
    const hadPreviousValue = previousByFieldId.has(entry.field.id);
    const previousValue = previousByFieldId.get(entry.field.id);
    if (hadPreviousValue && sameFormEntityValue(previousValue, entry.value)) return [];
    return [
      {
        fieldId: entry.field.id,
        fieldName: entry.field.fieldName,
        newActualValue: entry.value,
        newFieldValue: entry.fieldValue,
        previousValue: hadPreviousValue ? (previousValue ?? null) : undefined,
        hadPreviousValue,
      },
    ];
  });
}

// Same follow-ups a form save from the UI gets: search reindex, counts, app and automation events.
async function emitFormSideEffects(
  ticketId: string,
  changed: ChangedCustomField[],
  updatedBy: string,
): Promise<void> {
  if (changed.length === 0) return;
  await emitCustomFieldWriteSideEffects(ticketId, changed, updatedBy).catch(err =>
    logger.warn(`[automations] stage form side effects failed ticketId=${ticketId}:`, err),
  );
}
