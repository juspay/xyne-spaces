import { Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import {
  AttachmentEntityType,
  FormEntityType,
  FormFieldType,
  Schema,
  resolveParentOption,
} from '@xyne/shared';
import { stringFromFormValue } from '@xyne/shared/zero';
import { zql } from './queries';

export type BranchableMutatorField = {
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: unknown;
  parentOptionId?: string | null;
};

// Same three rules formsRepository.ts enforces on the REST path: the referenced option must
// exist, its owning field must be Single Select, and that field must not itself be branch-scoped.
// Without this, a client using this mutator directly (bypassing REST) could write a
// parentOptionId that formsRepository.ts would have rejected.
export const validateFieldBranch = (
  field: BranchableMutatorField,
  allFields: readonly BranchableMutatorField[],
): void => {
  if (!field.parentOptionId) return;

  const resolved = resolveParentOption(allFields, field.parentOptionId);
  if (!resolved) {
    throw new Error(
      `Field "${field.fieldName}" references an option that doesn't exist on any field in this form`,
    );
  }
  if (resolved.parentField.fieldType !== FormFieldType.SINGLE_SELECT) {
    throw new Error(`Field "${field.fieldName}" can only belong to a branch of a Single Select field`);
  }
  if (resolved.parentField.parentOptionId) {
    throw new Error(
      `Field "${field.fieldName}" cannot belong to a branch of "${resolved.parentField.fieldName}" — that field is itself in a branch, only one level is allowed`,
    );
  }
};

export const validateFieldBranches = (fields: readonly BranchableMutatorField[]): void => {
  for (const field of fields) {
    validateFieldBranch(field, fields);
  }
};

export const validateUniqueFieldNames = (fields: readonly BranchableMutatorField[]): void => {
  const seen = new Set<string>();

  for (const field of fields) {
    const normalizedName = field.fieldName.trim().toLowerCase();
    if (!normalizedName) continue;

    if (seen.has(normalizedName)) {
      throw new Error('Duplicate field names are not allowed');
    }
    seen.add(normalizedName);
  }
};

// Mirrors ticketController.ts's REST-side active-field check. formEntityValue is a separate
// write path (ticket-detail inline edits, stage forms) that REST validation never sees, so a
// branch-scoped field's parent value has to be checked here too, not just on field definitions.
export async function assertFieldIsCurrentlyActive(
  tx: Transaction<Schema>,
  field: { id: string; formId: string; fieldName: string; parentOptionId?: string | null },
  entityId: string,
  entityType: string,
): Promise<void> {
  if (!field.parentOptionId) return;

  const siblingRows = await tx.run(
    zql.form_fields.where('formId', field.formId).related('globalField'),
  );
  const siblingFields = siblingRows.flatMap(row => {
    const fieldName = row.globalField?.fieldName ?? row.fieldName;
    const fieldType = row.globalField?.fieldType ?? row.fieldType;
    // Prefer the canonical {id,value}[] (fieldOptions) so resolveParentOption can match the
    // child's parentOptionId; fieldEnum is now the string[] projection with no option ids.
    const fieldEnum =
      row.globalField?.fieldOptions ??
      row.globalField?.fieldEnum ??
      row.fieldOptions ??
      row.fieldEnum;
    if (!fieldName || !fieldType) return [];

    return [{
      ...row,
      id: row.globalFieldId ?? row.id,
      fieldName,
      fieldType,
      fieldEnum,
    }];
  });
  const resolved = resolveParentOption(siblingFields, field.parentOptionId);
  if (!resolved) {
    throw new Error(
      `Field "${field.fieldName}" is not applicable — its branch reference is invalid`,
    );
  }

  const parentValues = await tx.run(
    zql.form_entity_values
      .where('entityId', entityId)
      .where('entityType', entityType)
      .where('fieldId', resolved.parentField.id)
      .orderBy('updatedAt', 'desc')
      .limit(1),
  );
  const parentRaw = parentValues[0]?.actualFieldValue ?? parentValues[0]?.fieldValue;
  const parentEffectiveValue = typeof parentRaw === 'string' ? parentRaw : null;

  if (resolved.option.value !== parentEffectiveValue) {
    throw new Error(
      `Field "${field.fieldName}" is not applicable for the currently selected value of its parent field`,
    );
  }
}

export const FORM_VALUE_CHANGED_MESSAGE =
  'Form value changed. Review the latest form changes before saving.';

type ActiveCheckField = {
  id: string;
  formId: string;
  fieldName: string;
  parentOptionId?: string | null;
};

// A form value that has been written but whose branch activity is not yet checked. The check
// is deferred so a batch can write a parent and its branch children before validating either.
export type FormEntityValueWrite = {
  entityId: string;
  entityType: string;
  fieldName: string | null;
  activeCheckField: ActiveCheckField | null;
};

const toStoredFormValue = (fieldType: FormFieldType, newValue: string[]): string[] | string | null => {
  const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
  // MULTI_SELECT/USER keep the array (including empty); everything else stores its first element.
  return isMultiValue ? newValue : newValue[0] || null;
};

// DOC values point at an attachment the upload pipeline already bound to this form value row
// (entityType=FORM_ENTITY_VALUE, entityId = the row id pre-allocated client-side).
async function assertDocAttachmentBound(
  tx: Transaction<Schema>,
  entityType: string,
  fieldType: FormFieldType,
  storedValue: string[] | string | null,
  formEntityValueId: string,
): Promise<void> {
  if (entityType !== FormEntityType.TICKET || fieldType !== FormFieldType.DOC) return;
  const attachmentId = stringFromFormValue(storedValue);
  if (!attachmentId) return;

  const attachment = await tx.run(zql.message_attachments.where('id', attachmentId).one());
  if (
    attachment &&
    (attachment.entityId !== formEntityValueId ||
      attachment.entityType !== AttachmentEntityType.FORM_ENTITY_VALUE)
  ) {
    throw new Error('Attachment is not bound to this form value');
  }
}

export type CreateFormEntityValueInput = {
  workspaceId: string;
  id: string;
  entityId: string;
  entityType: FormEntityType;
  fieldId: string;
  formId: string;
  newValue: string[];
  timestamp: number;
  contextId?: string;
  version?: number;
};

// Inserts a form value. Does not run the branch-activity check — callers must pass the result
// to assertFormEntityValueWritesActive once every write in the transaction is done.
export async function writeFormEntityValueCreate(
  tx: Transaction<Schema>,
  input: CreateFormEntityValueInput,
): Promise<FormEntityValueWrite> {
  const { workspaceId, id, entityId, entityType, fieldId, formId, newValue, timestamp, contextId, version } = input;

  // fieldId may reference a new global_fields definition or a legacy form_fields row.
  const globalField = await tx.run(zql.global_fields.where('id', fieldId).one());
  const legacyField = globalField
    ? null
    : await tx.run(zql.form_fields.where('id', fieldId).related('globalField').one());

  const resolvedFieldId = globalField?.id ?? legacyField?.globalFieldId ?? legacyField?.id;
  const fieldType = globalField?.fieldType ?? legacyField?.globalField?.fieldType ?? legacyField?.fieldType;
  if (!resolvedFieldId || !fieldType) {
    throw new Error('Form field not found');
  }

  let membership: { parentOptionId?: string | null } | null | undefined;
  if (globalField) {
    membership = await tx.run(
      zql.form_fields
        .where('formId', formId)
        .where('globalFieldId', globalField.id)
        .related('globalField')
        .one(),
    );
    if (!membership) {
      throw new Error('Form field not found in this form');
    }
  } else if (legacyField?.formId !== formId) {
    throw new Error('Form field not found in this form');
  } else {
    membership = legacyField;
  }
  const fieldName =
    globalField?.fieldName ?? legacyField?.globalField?.fieldName ?? legacyField?.fieldName ?? null;

  const actualFieldValue = toStoredFormValue(fieldType, newValue);
  // DOC fields no longer require a claim here — the upload pipeline
  // (POST /attachments/upload from StageFormModal.handleSubmit) writes
  // the MessageAttachment row directly with entityType=FORM_ENTITY_VALUE
  // and entityId = this row's id (pre-allocated client-side). So by the
  // time we insert the form value row, the attachment is already
  // pointing at it correctly.

  // Upsert the form entity value
  await tx.mutate.form_entity_values.insert({
    workspaceId,
    id,
    entityId,
    entityType,
    fieldId: resolvedFieldId,
    formId,
    ...(contextId && { contextId }),
    version: version ?? 1,
    fieldValue: '',
    actualFieldValue,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await assertDocAttachmentBound(tx, entityType, fieldType, actualFieldValue, id);

  return {
    entityId,
    entityType,
    fieldName,
    activeCheckField: {
      id: resolvedFieldId,
      formId,
      fieldName: fieldName ?? 'Field',
      parentOptionId: membership?.parentOptionId,
    },
  };
}

export type UpdateFormEntityValueInput = {
  formEntityValueId: string;
  newValue: string[];
  updatedAt: number;
  expectedValueUpdatedAt?: number | null;
};

// Updates a form value. Same contract as writeFormEntityValueCreate: the branch-activity check
// is left to assertFormEntityValueWritesActive. When `expectedEntity` is given, the row must
// belong to that entity (batch callers name one entity for every value they write).
export async function writeFormEntityValueUpdate(
  tx: Transaction<Schema>,
  input: UpdateFormEntityValueInput,
  expectedEntity?: { entityId: string; entityType: string },
): Promise<FormEntityValueWrite> {
  const { formEntityValueId, newValue, updatedAt, expectedValueUpdatedAt } = input;

  const formEntityValue = await tx.run(
    zql.form_entity_values
      .where('id', formEntityValueId)
      .related('formField')
      .related('globalField')
      .one(),
  );
  if (!formEntityValue) {
    throw new Error('Form entity value not found');
  }
  if (
    expectedEntity &&
    (formEntityValue.entityId !== expectedEntity.entityId ||
      formEntityValue.entityType !== expectedEntity.entityType)
  ) {
    throw new Error('Form entity value does not belong to this entity');
  }
  if (
    expectedValueUpdatedAt !== undefined &&
    (formEntityValue.updatedAt ?? null) !== expectedValueUpdatedAt
  ) {
    throw new Error(FORM_VALUE_CHANGED_MESSAGE);
  }

  const fieldType = formEntityValue.globalField?.fieldType ?? formEntityValue.formField?.fieldType;
  const resolvedFieldName =
    formEntityValue.globalField?.fieldName ?? formEntityValue.formField?.fieldName ?? null;
  const membership = formEntityValue.formField
    ?? (formEntityValue.globalField
      ? await tx.run(
        zql.form_fields
          .where('formId', formEntityValue.formId)
          .where('globalFieldId', formEntityValue.globalField.id)
          .related('globalField')
          .one(),
      )
      : null);

  const valueToStore = fieldType
    ? toStoredFormValue(fieldType, newValue)
    : newValue[0] || null;
  if (fieldType) {
    await assertDocAttachmentBound(
      tx,
      formEntityValue.entityType,
      fieldType,
      valueToStore,
      formEntityValueId,
    );
  }

  await tx.mutate.form_entity_values.update({
    id: formEntityValueId,
    actualFieldValue: valueToStore,
    updatedAt,
  });

  return {
    entityId: formEntityValue.entityId,
    entityType: formEntityValue.entityType,
    fieldName: resolvedFieldName,
    activeCheckField: membership
      ? {
        id: membership.globalFieldId ?? membership.id,
        formId: membership.formId,
        fieldName:
          (membership as { globalField?: { fieldName?: string | null } }).globalField?.fieldName
          ?? membership.fieldName
          ?? resolvedFieldName
          ?? 'Field',
        parentOptionId: membership.parentOptionId,
      }
      : null,
  };
}

// Runs the branch-activity check for every write, against the transaction's final state.
export async function assertFormEntityValueWritesActive(
  tx: Transaction<Schema>,
  writes: readonly FormEntityValueWrite[],
): Promise<void> {
  for (const write of writes) {
    if (!write.activeCheckField) continue;
    await assertFieldIsCurrentlyActive(tx, write.activeCheckField, write.entityId, write.entityType);
  }
}

export const upsertManyFormEntityValuesArgs = z.object({
  entityId: z.string(),
  entityType: z.nativeEnum(FormEntityType),
  formId: z.string(),
  timestamp: z.number(),
  contextId: z.string().optional(),
  version: z.number().optional(),
  values: z
    .array(
      z.discriminatedUnion('op', [
        z.object({
          op: z.literal('create'),
          id: z.string(),
          fieldId: z.string(),
          newValue: z.array(z.string()),
        }),
        z.object({
          op: z.literal('update'),
          formEntityValueId: z.string(),
          newValue: z.array(z.string()),
          expectedValueUpdatedAt: z.number().nullable().optional(),
        }),
      ]),
    )
    .min(1),
});

export type UpsertManyFormEntityValuesArgs = z.infer<typeof upsertManyFormEntityValuesArgs>;

// Writes every value of one entity's form in a single transaction, then validates branch
// activity against the result. A child field is checked against its parent's new value no
// matter where either sits in `values`, and any failure rolls the whole form back.
export async function upsertManyFormEntityValues(
  tx: Transaction<Schema>,
  workspaceId: string,
  args: UpsertManyFormEntityValuesArgs,
): Promise<FormEntityValueWrite[]> {
  const { entityId, entityType, formId, timestamp, contextId, version, values } = args;

  const writes: FormEntityValueWrite[] = [];
  for (const value of values) {
    writes.push(
      value.op === 'create'
        ? await writeFormEntityValueCreate(tx, {
          workspaceId,
          id: value.id,
          entityId,
          entityType,
          fieldId: value.fieldId,
          formId,
          newValue: value.newValue,
          timestamp,
          contextId,
          version,
        })
        : await writeFormEntityValueUpdate(
          tx,
          {
            formEntityValueId: value.formEntityValueId,
            newValue: value.newValue,
            updatedAt: timestamp,
            expectedValueUpdatedAt: value.expectedValueUpdatedAt,
          },
          { entityId, entityType },
        ),
    );
  }

  await assertFormEntityValueWritesActive(tx, writes);
  return writes;
}
