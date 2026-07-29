import { Transaction } from '@rocicorp/zero';
import { FormFieldType, Schema, resolveParentOption } from '@xyne/shared';
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
