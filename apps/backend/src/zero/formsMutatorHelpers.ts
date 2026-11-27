import { Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import {
  AttachmentEntityType,
  FormEntityType,
  assertFormFieldType,
  FormFieldType,
  Schema,
  formEntityValueItemId,
  readFormEntityValue,
  resolveParentOption,
  toTypedFormEntityValue,
  type FormFieldValue,
} from '@xyne/shared';
import { stringFromFormValue } from '@xyne/shared/zero';
import { formEntityValueTextHash } from '@/utils/formEntityValueHash';
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
      .limit(1)
      .related('items'),
  );
  const parentRaw = readFormEntityValue(parentValues[0]);
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

type DocAttachmentCheck = {
  entityType: string;
  fieldType: FormFieldType;
  storedValue: string[] | string | null;
  formEntityValueId: string;
};

// A form value that has been written but not yet validated. Validation is deferred to
// assertFormEntityValueWrites so a batch can write a parent and its branch children before
// checking either.
export type FormEntityValueWrite = {
  formEntityValueId: string;
  fieldId: string;
  entityId: string;
  entityType: string;
  fieldName: string | null;
  activeCheckField: ActiveCheckField | null;
  docCheck: DocAttachmentCheck | null;
};

// Membership row of a field in a form, either a global field's row or a legacy definition row.
type FormFieldMembership = {
  id: string;
  formId: string;
  globalFieldId?: string | null;
  fieldName?: string | null;
  parentOptionId?: string | null;
  globalField?: { fieldName?: string | null } | null;
};

const toStoredFormValue = (fieldType: FormFieldType | null | undefined, newValue: string[]): string[] | string | null => {
  const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
  // MULTI_SELECT/USER keep the array (including empty); everything else stores its first element.
  return isMultiValue ? newValue : newValue[0] || null;
};

const toActiveCheckField = (
  membership: FormFieldMembership,
  fallbackFieldName: string | null,
): ActiveCheckField => ({
  id: membership.globalFieldId ?? membership.id,
  formId: membership.formId,
  fieldName: membership.globalField?.fieldName ?? membership.fieldName ?? fallbackFieldName ?? 'Field',
  parentOptionId: membership.parentOptionId,
});

const toDocCheck = (
  entityType: string,
  fieldType: FormFieldType | null | undefined,
  storedValue: string[] | string | null,
  formEntityValueId: string,
): DocAttachmentCheck | null =>
  fieldType === FormFieldType.DOC
    ? { entityType, fieldType, storedValue, formEntityValueId }
    : null;

// DOC values point at an attachment the upload pipeline already bound to this form value row
// (POST /attachments/upload writes it with entityType=FORM_ENTITY_VALUE and entityId = the row
// id pre-allocated client-side), so no claim happens here — only a check that it matches.
async function assertDocAttachmentBound(
  tx: Transaction<Schema>,
  check: DocAttachmentCheck,
): Promise<void> {
  if (check.entityType !== FormEntityType.TICKET || check.fieldType !== FormFieldType.DOC) return;
  const attachmentId = stringFromFormValue(check.storedValue);
  if (!attachmentId) return;

  const attachment = await tx.run(zql.message_attachments.where('id', attachmentId).one());
  if (
    attachment &&
    (attachment.entityId !== check.formEntityValueId ||
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

// Inserts a form value. Validation is left to assertFormEntityValueWrites, which callers must
// run once every write in the transaction is done.
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

  let membership: FormFieldMembership | undefined;
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
  } else if (!legacyField || legacyField.formId !== formId) {
    throw new Error('Form field not found in this form');
  } else {
    membership = legacyField;
  }
  const fieldName =
    globalField?.fieldName ?? legacyField?.globalField?.fieldName ?? legacyField?.fieldName ?? null;

  const actualFieldValue = toStoredFormValue(fieldType, newValue);
  await insertFormEntityValue(tx, {
    id,
    workspaceId,
    formId,
    entityId,
    entityType,
    fieldId: resolvedFieldId,
    contextId,
    version: version ?? 1,
    fieldType: assertFormFieldType(fieldType, resolvedFieldId),
    value: actualFieldValue,
    timestamp,
  });

  return {
    formEntityValueId: id,
    fieldId: resolvedFieldId,
    entityId,
    entityType,
    fieldName,
    activeCheckField: toActiveCheckField(membership, fieldName),
    docCheck: toDocCheck(entityType, fieldType, actualFieldValue, id),
  };
}

export type UpdateFormEntityValueInput = {
  formEntityValueId: string;
  newValue: string[];
  updatedAt: number;
  expectedValueUpdatedAt?: number | null;
};

// The form a batch is saving: every value it updates must belong to this entity, this form
// and this context.
export type FormEntityValueBatchScope = {
  entityId: string;
  entityType: string;
  formId: string;
  contextId?: string;
};

// Updates a form value. Same contract as writeFormEntityValueCreate. With `scope` (batch
// saves), the row must belong to that entity and context and its field to that form; the
// branch check then uses the field's placement in that form.
export async function writeFormEntityValueUpdate(
  tx: Transaction<Schema>,
  input: UpdateFormEntityValueInput,
  scope?: FormEntityValueBatchScope,
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

  if (scope) {
    if (
      formEntityValue.entityId !== scope.entityId ||
      formEntityValue.entityType !== scope.entityType
    ) {
      throw new Error('Form entity value does not belong to this entity');
    }
    if ((formEntityValue.contextId ?? null) !== (scope.contextId ?? null)) {
      throw new Error('Form entity value does not belong to this form context');
    }
    if (formEntityValue.formId !== scope.formId) {
      throw new Error('Form entity value does not belong to this form');
    }
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
  const valueToStore = toStoredFormValue(fieldType, newValue);
  await updateFormEntityValue(tx, {
    id: formEntityValueId,
    workspaceId: formEntityValue.workspaceId,
    fieldType: assertFormFieldType(fieldType, formEntityValue.fieldId),
    value: valueToStore,
    updatedAt,
  });

  return {
    formEntityValueId,
    fieldId: formEntityValue.fieldId,
    entityId: formEntityValue.entityId,
    entityType: formEntityValue.entityType,
    fieldName: resolvedFieldName,
    activeCheckField: membership ? toActiveCheckField(membership, resolvedFieldName) : null,
    docCheck: toDocCheck(formEntityValue.entityType, fieldType, valueToStore, formEntityValueId),
  };
}

// Validates writes against the transaction's final state: every branch-activity check first,
// then every DOC attachment check (the same error precedence the single-value mutators had).
export async function assertFormEntityValueWrites(
  tx: Transaction<Schema>,
  writes: readonly FormEntityValueWrite[],
): Promise<void> {
  for (const write of writes) {
    if (!write.activeCheckField) continue;
    await assertFieldIsCurrentlyActive(
      tx,
      write.activeCheckField,
      write.entityId,
      write.entityType,
    );
  }
  for (const write of writes) {
    if (write.docCheck) await assertDocAttachmentBound(tx, write.docCheck);
  }
}

export const upsertManyFormEntityValuesArgs = z
  .object({
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
  })
  .superRefine(({ values }, ctx) => {
    const seenValueIds = new Set<string>();
    const seenCreateFieldIds = new Set<string>();
    values.forEach((value, index) => {
      const valueId = value.op === 'create' ? value.id : value.formEntityValueId;
      if (seenValueIds.has(valueId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', index],
          message: `Form value ${valueId} appears more than once in this save`,
        });
      }
      seenValueIds.add(valueId);

      if (value.op !== 'create') return;
      if (seenCreateFieldIds.has(value.fieldId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', index],
          message: `Field ${value.fieldId} appears more than once in this save`,
        });
      }
      seenCreateFieldIds.add(value.fieldId);
    });
  });

export type UpsertManyFormEntityValuesArgs = z.infer<typeof upsertManyFormEntityValuesArgs>;

// Writes every value of one entity's form in a single transaction, then validates the result.
// A child field is checked against its parent's new value no matter where either sits in
// `values`, and any failure rolls the whole form back.
export async function upsertManyFormEntityValues(
  tx: Transaction<Schema>,
  workspaceId: string,
  args: UpsertManyFormEntityValuesArgs,
): Promise<FormEntityValueWrite[]> {
  const { entityId, entityType, formId, timestamp, contextId, version, values } = args;
  const scope: FormEntityValueBatchScope = { entityId, entityType, formId, contextId };

  const writes: FormEntityValueWrite[] = [];
  const writtenFieldIds = new Set<string>();
  for (const value of values) {
    const write = value.op === 'create'
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
        scope,
      );
    // Catches what the schema can't see: two entries resolving to the same field (e.g. a
    // create by global id and an update of that field's row).
    if (writtenFieldIds.has(write.fieldId)) {
      throw new Error(`Field "${write.fieldName ?? write.fieldId}" appears more than once in this save`);
    }
    writtenFieldIds.add(write.fieldId);
    writes.push(write);
  }

  await assertFormEntityValueWrites(tx, writes);
  return writes;
}

// Dual write: clients that still read actualFieldValue keep seeing current values.
const legacyJsonValue = (value: unknown): FormFieldValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || Array.isArray(value)) return value as FormFieldValue;
  return String(value);
};

const storedFormEntityValueFields = (fieldType: FormFieldType, value: unknown, fieldId: string) => {
  const typed = toTypedFormEntityValue(assertFormFieldType(fieldType, fieldId), value);
  const textHash = typed.textHashInput === null ? null : formEntityValueTextHash(typed.textHashInput);
  return { fields: { ...typed.columns, textHash, actualFieldValue: legacyJsonValue(value) }, items: typed.items };
};

// Makes the value's form_entity_value_items rows exactly `items`. Item ids are derived, so
// re-adding an item keeps its row and the client's optimistic rows match the server's.
async function replaceFormEntityValueItems(
  tx: Transaction<Schema>,
  value: { id: string; workspaceId: string },
  items: readonly string[],
  createdAt: number,
): Promise<void> {
  const wanted = new Set(items);
  const existing = await tx.run(zql.form_entity_value_items.where('valueId', value.id));
  const existingItems = new Set(existing.map(row => row.item));
  for (const row of existing) {
    if (!wanted.has(row.item)) await tx.mutate.form_entity_value_items.delete({ id: row.id });
  }
  for (const item of wanted) {
    if (existingItems.has(item)) continue;
    await tx.mutate.form_entity_value_items.insert({
      id: formEntityValueItemId(value.id, item),
      workspaceId: value.workspaceId,
      valueId: value.id,
      item,
      createdAt,
    });
  }
}

/**
 * The only Zero writes of form_entity_values and its items: callers pass the field's type
 * and value, and the storage (typed columns, textHash, item rows) stays here. The
 * local-rules/form-entity-values-through-repository lint rule enforces it.
 */
export async function insertFormEntityValue(
  tx: Transaction<Schema>,
  input: {
    id: string;
    workspaceId: string;
    formId: string;
    entityId: string;
    entityType: string;
    fieldId: string;
    contextId?: string | undefined;
    version: number;
    fieldType: FormFieldType;
    value: unknown;
    timestamp: number;
  },
): Promise<void> {
  const stored = storedFormEntityValueFields(input.fieldType, input.value, input.id);
  await tx.mutate.form_entity_values.insert({
    workspaceId: input.workspaceId,
    id: input.id,
    formId: input.formId,
    entityId: input.entityId,
    entityType: input.entityType,
    fieldId: input.fieldId,
    ...(input.contextId && { contextId: input.contextId }),
    version: input.version,
    fieldValue: '',
    ...stored.fields,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });
  await replaceFormEntityValueItems(tx, input, stored.items, input.timestamp);
}

export async function updateFormEntityValue(
  tx: Transaction<Schema>,
  input: { id: string; workspaceId: string; fieldType: FormFieldType; value: unknown; updatedAt: number },
): Promise<void> {
  const stored = storedFormEntityValueFields(input.fieldType, input.value, input.id);
  await tx.mutate.form_entity_values.update({ id: input.id, ...stored.fields, updatedAt: input.updatedAt });
  await replaceFormEntityValueItems(tx, input, stored.items, input.updatedAt);
}

/** Moves a row to another field or version without touching its value. */
export async function moveFormEntityValue(
  tx: Transaction<Schema>,
  input: { id: string; fieldId?: string; version?: number; updatedAt: number },
): Promise<void> {
  await tx.mutate.form_entity_values.update({
    id: input.id,
    ...(input.fieldId !== undefined && { fieldId: input.fieldId }),
    ...(input.version !== undefined && { version: input.version }),
    updatedAt: input.updatedAt,
  });
}

// Zero deletes do not cascade (relationMode = "prisma"), so items are removed explicitly.
export async function deleteFormEntityValue(tx: Transaction<Schema>, id: string): Promise<void> {
  const items = await tx.run(zql.form_entity_value_items.where('valueId', id));
  for (const row of items) await tx.mutate.form_entity_value_items.delete({ id: row.id });
  await tx.mutate.form_entity_values.delete({ id });
}
