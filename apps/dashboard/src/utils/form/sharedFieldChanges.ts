import type { BuilderField } from './formBuilderTypes';

/** The part of a field that lives on its shared definition (not on this form's membership). */
export interface FieldDefinitionSnapshot {
  fieldName: string;
  fieldType: string;
  options: string;
}

export const snapshotFieldDefinition = (
  field: Pick<BuilderField, 'fieldName' | 'fieldType' | 'fieldEnum'>,
): FieldDefinitionSnapshot => ({
  fieldName: field.fieldName.trim(),
  fieldType: field.fieldType,
  options: JSON.stringify(
    (field.fieldEnum ?? [])
      .map(option => [option.id, option.value.trim()])
      .filter(([, value]) => value),
  ),
});

/** Snapshots keyed by definition id, for every field that points at a shared definition. */
export const snapshotSharedFields = (
  fields: BuilderField[],
): Map<string, FieldDefinitionSnapshot> =>
  new Map(
    fields.flatMap(field =>
      isSharedField(field) ? [[field.definitionId, snapshotFieldDefinition(field)] as const] : [],
    ),
  );

// A legacy row carries its own definition (definitionId === membershipId) and belongs to this
// form only; anything else points at a project-wide definition other forms may use.
const isSharedField = (field: BuilderField): field is BuilderField & { definitionId: string } =>
  Boolean(field.definitionId) && field.definitionId !== field.membershipId;

/**
 * Existing shared fields whose name, type or options differ from the baseline. Required-ness
 * and branch placement are per-form and never count.
 */
export const getEditedSharedFields = (
  baseline: ReadonlyMap<string, FieldDefinitionSnapshot>,
  fields: BuilderField[],
): Array<{ field: BuilderField; originalName: string }> =>
  fields.flatMap(field => {
    if (!isSharedField(field)) return [];
    const original = baseline.get(field.definitionId);
    if (!original) return [];
    const current = snapshotFieldDefinition(field);
    const changed =
      current.fieldName !== original.fieldName ||
      current.fieldType !== original.fieldType ||
      current.options !== original.options;
    return changed ? [{ field, originalName: original.fieldName }] : [];
  });
